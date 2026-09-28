@echo off
rem Start the local PostgreSQL (scoop install, per-user; not a Windows service).
rem Run once after each reboot, or register it as a service from an elevated prompt:
rem   pg_ctl register -N PostgreSQL -D "%USERPROFILE%\scoop\persist\postgresql\data"
"%USERPROFILE%\scoop\apps\postgresql\current\bin\pg_ctl.exe" -D "%USERPROFILE%\scoop\persist\postgresql\data" -l "%USERPROFILE%\scoop\persist\postgresql\pg.log" start
