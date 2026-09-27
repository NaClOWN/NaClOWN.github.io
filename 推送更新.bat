@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   抽取灵感 · 把本地改动推送到 GitHub
echo ============================================
echo.

set "NODE="
for /f "delims=" %%p in ('where node 2^>nul') do if not defined NODE set "NODE=%%p"

set "GIT="
for %%p in (
  "C:\Users\hp\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe"
  "%ProgramFiles%\Git\cmd\git.exe"
  "%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
) do if not defined GIT if exist %%p set "GIT=%%~p"
if not defined GIT for /f "delims=" %%p in ('where git 2^>nul') do if not defined GIT set "GIT=%%p"
if not defined GIT (
  echo 找不到 git.exe，没法自动推送。
  echo 可以改用在 GitHub 网页上直接修改文件的方式，见 README。
  echo.
  pause
  exit /b 1
)

rem 这台机器连 github.com 的 HTTPS 被阻断，所以走 SSH 的 443 端口
set "GIT_SSH_COMMAND=C:/Windows/System32/OpenSSH/ssh.exe -i C:/Users/hp/.ssh/id_ed25519 -o IdentitiesOnly=yes -o HostName=ssh.github.com -o Port=443 -o StrictHostKeyChecking=accept-new"

echo [1/5] 检查卡池文件
if defined NODE (
  "%NODE%" "tools\check-pool.js"
  if errorlevel 1 (
    echo.
    echo 卡池文件有问题，先按上面的提示修好再推送。
    echo.
    pause
    exit /b 1
  )
) else (
  echo  没找到 node，跳过检查
)

echo.
echo [2/5] 暂存改动
"%GIT%" add -A
"%GIT%" status --short

echo.
echo [3/5] 提交
set "MSG=%~1"
if "%MSG%"=="" set "MSG=更新卡池"
"%GIT%" commit -m "%MSG%"

echo.
echo [4/5] 同步远程改动（防止你刚在网页上改过东西）
"%GIT%" pull --rebase
if errorlevel 1 (
  echo.
  echo 同步失败：远程的改动和本地冲突了，需要手动合并。
  echo 把这个窗口里的内容发给 Codex，让它帮你合。
  echo.
  pause
  exit /b 1
)

echo.
echo [5/5] 推送
"%GIT%" push
if errorlevel 1 (
  echo.
  echo 推送失败：多半是网络抖动或 SSH 密钥没了，再跑一次这个文件试试。
) else (
  echo.
  echo 推送完成。等 1 分钟左右刷新 https://naclown.github.io/ 就能看到。
  echo 只改卡池 JSON 不用清缓存；改了 assets 里的代码记得把 index.html 的 ?v= 加一。
)
echo.
pause
