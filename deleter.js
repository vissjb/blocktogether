'use strict';
/** @type{SetupModule} */
var setup = require('./setup'),
    Q = require('q'),
    Op = require('sequelize').Op;

var logger = setup.logger,
    BtUser = setup.BtUser,
    BlockBatch = setup.BlockBatch,
    Action = setup.Action,
    sequelize = setup.sequelize;

/**
 * Find users who deactivated more than thirty days ago and delete them from the
 * DB. In theory we could just delete the user and the foreign key constraints
 * would take care of deleting the rest.  We do it this way (deleting the
 * associated tables first), because users who have really large numbers of
 * Actions or Blocks cause the BtUsers table to be locked for a super long time
 * while deleting those. We do rely on foreign key constraints to delete the
 * blocks associated with the BlockBatches.
 */
function findAndDeleteOneOldUser() {
  return BtUser
    .findOne({
      where: {
        deactivatedAt: {
          [Op.lt]: new Date(Date.now() - 30 * 86400 * 1000)
        }
      },
      order: [['deactivatedAt', 'ASC']]
    }).then(function(user) {
      if (user) {
        return deleteOneOldUser(user);
      } else {
        return Q.resolve(null);
      }
    }).catch(function(err) {
      logger.error(err);
    });
}

function deleteOneOldUser(user) {
  logger.info('deleting', user);
  return Action.destroy({
    where: {
      source_uid: user.uid
    }
  }).then(function() {
    return BlockBatch.destroy({
      where: {
        source_uid: user.uid
      }
    });
  }).then(function() {
    return user.destroy();
  }).catch(function(err) {
    logger.error(err);
  });
}

async function processEternally() {
  while (true) {
    await findAndDeleteOneOldUser();
    await Q.delay(1000);
  }
}

async function cleanDuplicateAndExternalActions() {
  const limit = 10000;
  for (;;) {
    var maxResult = await sequelize.query('SELECT max(id) FROM Actions;');
    var max = parseInt(maxResult[0][0]['max(id)']);
    for (let offset = 0; offset < max; offset += limit) {
      logger.info("cleanDuplicateAndExternalActions, offset = ", offset);
      await sequelize.query('DELETE FROM Actions WHERE (statusNum IN (3, 4, 5, 6, 7, 8, 9, 10) OR causeNum = 0) AND id > ? AND id < ? AND updatedAt < DATE_SUB(NOW(), INTERVAL 10 DAY);',
       {
         replacements: [offset, offset+limit],
         type: sequelize.QueryTypes.DELETE
       });
      await Q.delay(1000);
    }
    logger.info("restarting cleanDuplicateAndExternalActions loop");
    await Q.delay(1000);
  }
}

// For users with more than 50k Actions, delete the oldest ones.
async function cleanExcessActions() {
  for (;;) {
    let btUsers = await BtUser.findAll();
    for (let i = 0; i < btUsers.length; i++) {
      let user = btUsers[i];
      if (user.blockCount >= 50000) {
        logger.info('trimming old actions for', user);
        await sequelize.query('DELETE FROM Actions WHERE typeNum = 1 AND source_uid = ? AND updatedAt < DATE_SUB(NOW(), INTERVAL 30 DAY) LIMIT 10000;',
          {
            replacements: [user.uid],
            type: sequelize.QueryTypes.DELETE
          });
      }
      await Q.delay(500);
    };
  }
}

if (require.main === module) {
  setup.statsServer(6443);
  processEternally().catch(function(err) {
    logger.error(err);
  })
  cleanDuplicateAndExternalActions().catch(function(err) {
    logger.error(err);
  });
  cleanExcessActions().catch(function(err) {
    logger.error(err);
  });
}
