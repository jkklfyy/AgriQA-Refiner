# 自动化回复评分系统

一个专为大模型训练数据准备而设计的自动化回复评分与导出系统。

## 系统功能

### 1. 数据输入
- **数据库连接**: 从指定的 MySQL 数据库读取问题表 (questions)、回复表 (replies) 和图片表 (images)
- **Excel 上传**: 支持用户上传包含三个表的 Excel 文件

### 2. 智能评分
综合考量三个维度为每条回复计算质量得分（满分 1 分）：
- **采纳状态** (0.4 分): accepted_flag=1 获得 0.4 分
- **用户身份** (0.3/0.2/0.1 分): user_type=3/2/1 分别获得对应分数
- **内容详实度** (0.3/0.2/0.1 分): 
  - 超过 100 字：0.3 分
  - 50-100 字：0.2 分
  - 20-50 字：0.1 分

### 3. 数据导出
导出符合 Qwen 大模型训练格式的 JSON 文件：
- 自动匹配 question_no 关联三个表
- 选择同一问题下评分最高的回复作为 GPT 回答
- 自动提取图片文件名（去除 URL 前缀）
- 支持一个问题对应多张图片

## 项目结构

```
auto-reply-scoring-system/
├── backend/                    # 后端代码
│   ├── config/
│   │   └── database.py        # 【数据库配置在此文件】
│   ├── models/
│   │   └── models.py          # 数据库模型
│   ├── services/
│   │   ├── scoring.py         # 评分逻辑
│   │   └── export.py          # 导出逻辑
│   ├── routes/
│   │   └── api.py             # API 接口
│   ├── utils/
│   │   └── excel_parser.py    # Excel 解析
│   └── main.py                # 主入口
├── frontend/                   # 前端代码
│   ├── index.html             # 主页面
│   ├── css/
│   │   └── style.css          # 样式
│   └── js/
│       └── app.js             # 前端逻辑
├── uploads/                    # 上传文件目录
├── outputs/                    # 导出文件目录
├── requirements.txt           # Python 依赖
└── README.md                  # 项目说明
```

## 安装步骤

### 1. 环境要求
- Python 3.8+
- MySQL 数据库（如使用数据库连接方式）
- Node.js（可选，用于前端开发）

### 2. 安装依赖

```bash
cd auto-reply-scoring-system
pip install -r requirements.txt
```

### 3. 数据库配置

编辑 `backend/config/database.py` 文件，配置数据库连接信息：

```python
DB_CONFIG = {
    'host': 'localhost',           # 数据库主机地址
    'port': 3306,                 # 数据库端口
    'user': 'root',               # 数据库用户名
    'password': 'your_password', # 数据库密码
    'database': 'your_database', # 数据库名称
    'charset': 'utf8mb4'
}
```

### 4. 数据库表结构

确保数据库中包含以下三张表：

**questions 表**:
```sql
CREATE TABLE questions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    question_no VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(500),
    content TEXT,
    created_at DATETIME
);
```

**replies 表**:
```sql
CREATE TABLE replies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    question_no VARCHAR(50) NOT NULL,
    content TEXT,
    accepted_flag INT DEFAULT 0,
    user_type INT DEFAULT 1,
    evl INT DEFAULT 0,
    created_at DATETIME
);
```

**images 表**:
```sql
CREATE TABLE images (
    id INT PRIMARY KEY AUTO_INCREMENT,
    entity_id VARCHAR(50) NOT NULL,
    url VARCHAR(1000),
    created_at DATETIME
);
```

## 使用方法

### 方式一：数据库连接

1. 启动后端服务：
```bash
cd backend
python main.py
```

2. 访问前端页面：
打开浏览器访问 `http://localhost:5000`

3. 在页面中配置数据库连接信息并连接

4. 点击"开始评分"进行评分

5. 点击"导出 JSON 文件"下载训练数据

### 方式二：Excel 上传

1. 准备 Excel 文件，包含三个 sheet：
   - `questions`: 问题表
   - `replies`: 回复表
   - `images`: 图片表

2. 启动服务并访问页面

3. 上传 Excel 文件

4. 进行评分和导出

## 导出格式示例

```json
[
  {
    "id": "qa_1920038098029314050",
    "image": [
      "e23282eb4dba45c38a173396445129e7.jpeg",
      "6b20b9dc7a9741e9812741daf1893296.jpeg"
    ],
    "conversations": [
      {
        "from": "human",
        "value": "<image> <image> 图中甜瓜叶片上出现多个散生的黄褐色小斑点..."
      },
      {
        "from": "gpt",
        "value": "诊断结论：该症状高度疑似**甜瓜炭疽病**..."
      }
    ]
  }
]
```

## API 接口

- `POST /api/connect-db`: 连接数据库
- `POST /api/score-database`: 从数据库评分
- `POST /api/upload-excel`: 上传 Excel 文件
- `POST /api/export-database`: 从数据库导出
- `POST /api/export-excel-data`: 从 Excel 数据导出
- `GET /api/download/<filename>`: 下载导出文件

## 注意事项

1. 数据库配置信息保存在 `backend/config/database.py`
2. 上传的 Excel 文件保存在 `uploads/` 目录
3. 导出的 JSON 文件保存在 `outputs/` 目录
4. 确保数据库表结构与模型定义一致
5. 评分结果会更新到数据库 replies 表的 evl 字段

## 技术栈

- **后端**: Flask + SQLAlchemy
- **前端**: 原生 HTML/CSS/JavaScript
- **数据库**: MySQL
- **数据处理**: Pandas

## 常见问题

**Q: 数据库连接失败？**
A: 检查 `backend/config/database.py` 中的配置是否正确，确保数据库服务已启动。

**Q: Excel 上传失败？**
A: 确保 Excel 文件包含正确的 sheet 名称（questions、replies、images）和必需的列。

**Q: 导出的 JSON 格式不符合要求？**
A: 检查数据中的 question_no 是否正确关联三个表，确保每个问题至少有一条回复。

## 许可证

本项目仅供学习和研究使用。
