@echo off
setlocal
title Datatilt-SuiviConsultant - serveur local
cd /d "%~dp0"
set PORT=3000
set URL=http://localhost:%PORT%

echo.
echo  ==============================================
echo    Datatilt-SuiviConsultant - lancement local
echo  ==============================================
echo.

if not exist "index.html" (
  echo  [ERREUR] index.html introuvable. Place ce fichier a la racine du projet.
  goto :fin
)

rem Le port 3000 doit rester celui declare dans Supabase (Redirect URLs).
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  echo  Le port %PORT% est deja utilise : l'application tourne peut-etre deja.
  echo  Ouverture de %URL% ...
  start "" "%URL%"
  goto :fin
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo  Serveur Node demarre sur %URL%
  echo  Laisse cette fenetre ouverte. Ctrl+C pour arreter.
  echo.
  start "" cmd /c "timeout /t 3 /nobreak >nul & start "" %URL%"
  call npx --yes serve@14.2.4 -l %PORT% .
  goto :fin
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo  Node.js absent : utilisation de Python.
  echo  Serveur demarre sur %URL% - laisse cette fenetre ouverte. Ctrl+C pour arreter.
  echo.
  start "" cmd /c "timeout /t 2 /nobreak >nul & start "" %URL%"
  python -m http.server %PORT%
  goto :fin
)

echo  [ERREUR] Ni Node.js ni Python ne sont installes.
echo  Installe Node.js (version LTS) depuis https://nodejs.org puis relance ce fichier.
start "" "https://nodejs.org/fr/download"

:fin
echo.
pause
