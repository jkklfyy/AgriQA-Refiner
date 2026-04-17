"""
自动化回复评分系统 - 主应用入口
"""

from flask import Flask, send_from_directory
from flask_cors import CORS
from flask.json.provider import DefaultJSONProvider
import os
import sys
from datetime import datetime, date, time

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from routes.api import api
from config.database import UPLOAD_FOLDER, OUTPUT_FOLDER

# 自定义 JSON 提供者，处理 datetime 类型
class CustomJSONProvider(DefaultJSONProvider):
    def __init__(self, app=None):
        super().__init__(app)
    
    def dumps(self, obj, **kwargs):
        def default_serializer(o):
            if isinstance(o, (datetime, date)):
                return o.isoformat()
            elif isinstance(o, time):  # time 类型
                return o.isoformat()
            raise TypeError(f'Object of type {type(o)} is not JSON serializable')
        
        return super().dumps(obj, default=default_serializer, **kwargs)

app = Flask(__name__, static_folder='../frontend')
CORS(app)

# 应用自定义 JSON 提供者（Flask 3.0+）
app.json = CustomJSONProvider(app)

# 注册蓝图
app.register_blueprint(api, url_prefix='/api')

# 确保必要的目录存在
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# 提供前端静态文件
@app.route('/')
def index():
    return send_from_directory('../frontend', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('../frontend', path)

if __name__ == '__main__':
    # 确保在正确的目录运行
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    app.run(host='0.0.0.0', port=8081, debug=False)