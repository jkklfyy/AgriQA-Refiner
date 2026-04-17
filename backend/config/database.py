# 数据库连接配置
# ========================================
# 在此处配置您的数据库连接信息
# ========================================

DB_CONFIG = {
    'host': '192.168.200.88',           # 数据库主机地址
    'port': 5432,                       # 数据库端口 (PostgreSQL 默认 5432, MySQL 默认 3306)
    'user': 'postgres',                 # 数据库用户名
    'password': '73B#1MjfaU7HjI',      # 数据库密码
    'database': 'data-center',          # 数据库名称
    'schema': 'test',                   # PostgreSQL schema（模式）名称
    'charset': 'utf8',
    'db_type': 'postgresql'             # 数据库类型：'postgresql' 或 'mysql'
}

# Excel 文件列名映射配置
EXCEL_COLUMN_MAPPING = {
    'questions': {
        'question_no': 'question_no',   # 问题编号
        'quiz_desc': 'quiz_desc'        # 问题内容
    },
    'replies': {
        'reply_no': 'reply_no',         # 回复 ID
        'question_no': 'question_no',  # 关联的问题编号
        'content': 'content',           # 回复内容
        'accepted_flag': 'accepted_flag',  # 采纳状态
        'user_type': 'user_type'        # 用户类型
    },
    'images': {
        'entity_id': 'entity_id',       # 关联的实体 ID (对应 question_no)
        'url': 'url'                    # 图片 URL
    }
}

# 评分规则配置
SCORING_RULES = {
    'accepted_flag': {
        'weight': 0.4,
        'condition': 'accepted_flag == 1'
    },
    'user_type': {
        'weights': {
            3: 0.3,
            2: 0.2,
            1: 0.1
        }
    },
    'content_length': {
        'thresholds': {
            100: 0.3,
            50: 0.2,
            20: 0.1
        }
    }
}

# MinIO 配置
MINIO_CONFIG = {
    'endpoint': "oss.aheagle.com",  # MinIO 服务地址
    'access_key': "ftNdI21pwBVL8hG0doyR",         # MinIO 访问密钥
    'secret_key': "H0SP1fA1Dv68iXOcVh8ERqkiVv2hkHRTsniVfQGE",         # MinIO 秘密密钥
    'bucket_name': 'aaic-common',       # 存储图片的桶名称
    'remote_path': '/huanghao/raw-data/',  # 远程路径前缀
    'secure': False  # 是否使用 HTTPS
}

# 文件上传配置
import os
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'uploads')
OUTPUT_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'outputs')
ALLOWED_EXTENSIONS = {'xlsx', 'xls'}
