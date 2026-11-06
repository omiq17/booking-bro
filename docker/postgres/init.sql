-- Enable btree_gist in default database (booking_bro)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Create isolated test database (booking_bro_test) and enable btree_gist
CREATE DATABASE booking_bro_test;
\connect booking_bro_test;
CREATE EXTENSION IF NOT EXISTS btree_gist;
