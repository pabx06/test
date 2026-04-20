CREATE DATABASE IF NOT EXISTS propriateraydb;
CREATE USER IF NOT EXISTS 'propriateraydb'@'%' IDENTIFIED BY 'propriateraydb';
GRANT ALL PRIVILEGES ON propriateraydb.* TO 'propriateraydb'@'%';
FLUSH PRIVILEGES;
