<?php
// eramaster-private/config.php — passwords and keys for EraMaster.
//
// WHERE THIS FILE GOES (outside the web folder, so Apache can never serve it):
//     C:\xampp\eramaster-private\config.php          <- next to the htdocs folder, NOT inside it
// (or keep it anywhere you like and set the ERAMASTER_CONFIG environment variable to its full path).
//
// Copy this template there, fill in the CHANGE_ME values, and never e-mail, zip or upload this file.
// api/config.php loads it automatically; anything defined here overrides the defaults.

/* ---- PostgreSQL: the restricted application user (created by server-setup/postgres/restrict-postgres.sql) ---- */
define('DB_HOST', '127.0.0.1');
define('DB_PORT', '5432');
define('DB_NAME', 'greenhill_academy');
define('DB_USER', 'eramaster_app');
define('DB_PASS', 'CHANGE_ME');              // the same password you give restrict-postgres.sql

/* ---- Production switches ---- */
define('APP_DEBUG', false);                      // true only while setting up: shows server error text in responses
// define('SOCIAL_REDIRECT_URI', 'https://your-school.example/api/social.php');
// define('BEHIND_HTTPS_PROXY', true);           // only if a trusted reverse proxy handles HTTPS for you
// define('SOCIAL_GOOGLE_ID', ''); define('SOCIAL_GOOGLE_SECRET', '');
