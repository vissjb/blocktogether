#!/bin/bash -e
# Back up MySQL DB and delete backups older than 7 days.
# Assumes there is a ~/.my.cnf like so:
# [mysqldump]
# user=blocktogether
# password=xyz123
TABLES="`mysql -e 'show tables' -B --skip-column-names`"
DB=blocktogether
for TABLE in $TABLES; do
  mysqldump \
    --single-transaction \
    --extended-insert \
    "$DB" "$TABLE" | gzip > \
    /data/mysql-backup/"$TABLE".$(date +%Y%m%d).gz
  # Clean up old backups
  find /data/mysql-backup/ -ctime +7 -exec rm {} \;
done
