<?php
// Copy to config.local.php and fill in. config.local.php is git-ignored.
return [
    'db' => [
        'dsn'  => 'pgsql:host=127.0.0.1;port=5432;dbname=rocalc',
        'user' => 'rocalc_app',
        'pass' => 'CHANGE_ME',
    ],
    'app' => [
        'env'             => 'production',   // 'development' shows DB error details; 'production' forces Secure cookies
        'session_name'    => 'rocalc_sid',
        'max_import_kb'   => 1024,
        'max_import_rows' => 2000,
    ],
];
