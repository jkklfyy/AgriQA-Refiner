@echo off
chcp 65001 >nul
title 自动化回复评分系统

echo ========================================
echo    自动化回复评分系统 - 启动器
echo ========================================
echo.

REM 检查 Python 是否已安装
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)

REM 检查依赖是否已安装
echo [1/3] 检查依赖...
pip show flask >nul 2>&1
if errorlevel 1 (
    echo        正在安装依赖...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

echo        依赖检查完成

REM 检查数据库配置
echo [2/3] 检查数据库配置...
if not exist "backend\config\database.py" (
    echo [错误] 配置文件不存在
    pause
    exit /b 1
)

echo        配置文件检查完成

REM 启动服务
echo [3/3] 启动服务...
echo.
echo 服务将在 http://localhost:5000 启动
echo 请在浏览器中打开上述地址
echo 按 Ctrl+C 可停止服务
echo.

cd /d "%~dp0backend"
python main.py

pause
