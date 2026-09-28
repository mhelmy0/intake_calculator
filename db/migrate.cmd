@echo off
rem Runs db\migrate.php with WAMP's PHP (php.exe is not on PATH by default). Arguments are passed through:
rem   db\migrate.cmd                          apply migrations + seed
rem   db\migrate.cmd --reset-password=admin   new one-time password for a user
rem   db\migrate.cmd --create-admin=NAME      create an admin user
"C:\wamp64\bin\php\php8.3.28\php.exe" "%~dp0migrate.php" %*
