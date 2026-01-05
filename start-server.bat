@echo off
echo ========================================
echo Playwright 本地服务器启动脚本
echo ========================================
echo.
echo 这个脚本会启动一个本地服务器，让 Obsidian 插件可以使用 Playwright
echo.
echo 服务器地址: http://localhost:3737
echo.
echo 按 Ctrl+C 可以停止服务器
echo.
echo ========================================
echo.

node server.cjs
