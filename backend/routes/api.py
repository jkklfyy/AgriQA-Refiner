"""
API 路由模块
提供前后端交互的接口
"""

from flask import Blueprint, request, jsonify, send_file
from flask_cors import CORS
import os
import sys
import json
import logging
from datetime import datetime, date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))));
from models.models import create_engine_and_session, Question, Reply, Image
from services.scoring import score_all_replies, calculate_reply_score
from services.export import export_from_database, prepare_training_data, export_to_json
from services.similarity import process_similarity_analysis
from utils.excel_parser import parse_excel_file, parse_single_excel_file, save_uploaded_file, validate_excel_data
from config.database import OUTPUT_FOLDER, MINIO_CONFIG

# 导入 MinIO 客户端
from minio import Minio
from minio.error import S3Error

# 初始化 MinIO 客户端
minio_client = Minio(
    MINIO_CONFIG['endpoint'],
    access_key=MINIO_CONFIG['access_key'],
    secret_key=MINIO_CONFIG['secret_key'],
    secure=MINIO_CONFIG['secure']
)

api = Blueprint('api', __name__)
CORS(api)  # 允许跨域请求

# 默认提示词配置
DEFAULT_PROMPTS = {
    'text': {
        'question': """你是一位专业的农业植保专家助理，负责将农户口语化、模糊的咨询问题，重新组织成标准、清晰、专业的农业问题。
                                    请严格遵循以下规则进行优化：
                                    1. 作物识别：明确作物种类（如无法确定，则描述为"该作物")，不改变原回答的核心诊断和关键建议；
                                    2. 修正明显错误：只修正科学事实错误，不添加个人推测，问题中不要有相关疑似病、虫、草害等推断或怀疑；
                                    3. 症状描述：基于问题客观描述病害/虫害/生理问题的症状特征，仅在原回答信息明显缺失、影响理解时补充最基本的信息；
                                    4. 专业表述：使用规范的农业术语，避免口语化表达，但是也要仿照农业人员的口吻；
                                    5. 结构完整：确保问题包含"作物+症状+疑问"三要素；
                                    6. 不要添加"后续说明"、"修改说明"等部分，整体长度控制在原回答的3倍以内；
                                    
                                    请基于原始问题，输出优化后的标准问题。
                                """,
        'answer': """你是一位资深植保专家，需要将口语化的农业解答优化为结构清晰、专业准确、可操作性强的农业解答，
                                遵守以下几点：
                                1. 保持核心信息：不改变原回答的核心诊断和关键建议；
                                2. 只做必要补充：仅在原回答信息明显缺失、影响理解时补充最基本的信息；
                                3. 修正明显错误：只修正科学事实错误，不添加个人推测，药剂建议必须基于原回答，不自行推荐新药剂；
                                4. 保持简洁：删除冗余修饰，使用书面化、专业但易于农户理解的语言，不要添加"后续说明"、"修改说明"等部分；
                                5. 整体回答长度控制在300字以内，不要有*符号。

                                请按照以下结构进行优化（按需使用，没有的点可以不列出，但是一定要有诊断结论！）：
                                1. 诊断结论：开篇明确点出病害/虫害/问题的名称。
                                2. 原因分析：简要说明发生原因（如气候、管理不当等）。
                                3. 防治措施：提供可操作的建议简述，参考原回答扩展。
                                4. 预防建议：补充农业防治、生态调控等长期预防措施简述。

                                请基于专业知识，对原回答进行适度优化，保持专业性和准确性，避免过度发挥。
                            """
    },
    'vl': {
        'question': """你是一位专业的农业植保专家助理，负责将农户口语化、模糊的咨询问题，重新组织成标准、清晰、专业的农业问题。
                                    请严格遵循以下规则进行优化：
                                    1. 作物识别：明确作物种类（如无法确定，则描述为"该作物")，不改变原回答的核心诊断和关键建议；
                                    2. 修正明显错误：只修正科学事实错误，不添加个人推测，问题中不要有相关疑似病、虫、草害等推断或怀疑；
                                    3. 症状描述：基于问题和图片客观描述病害/虫害/生理问题的症状特征，仅在原回答信息明显缺失、影响理解时补充最基本的信息；
                                    4. 专业表述：使用规范的农业术语，避免口语化表达，但是也要仿照农业人员的口吻；
                                    5. 结构完整：确保问题包含"作物+症状+疑问"三要素；
                                    6. 不要添加"后续说明"、"修改说明"等部分，整体长度控制在原回答的3倍以内；
                                    
                                    请基于原始问题和图片，输出优化后的标准问题。
                                """,
        'answer': """你是一位资深植保专家，需要将口语化的农业解答优化为结构清晰、专业准确、可操作性强的农业解答，
                                遵守以下几点：
                                1. 保持核心信息：不改变原回答的核心诊断和关键建议；
                                2. 只做必要补充：仅在原回答信息明显缺失、影响理解时补充最基本的信息，可结合图片信息进行补充；
                                3. 修正明显错误：只修正科学事实错误，不添加个人推测，药剂建议必须基于原回答，不自行推荐新药剂；
                                4. 保持简洁：删除冗余修饰，使用书面化、专业但易于农户理解的语言，不要添加"后续说明"、"修改说明"等部分；
                                5. 整体回答长度控制在300字以内，不要有*符号。

                                请按照以下结构进行优化（按需使用，没有的点可以不列出，但是一定要有诊断结论！）：
                                1. 诊断结论：开篇明确点出病害/虫害/问题的名称。
                                2. 原因分析：简要说明发生原因（如气候、管理不当等）。
                                3. 防治措施：提供可操作的建议简述，参考原回答扩展。
                                4. 预防建议：补充农业防治、生态调控等长期预防措施简述。

                                请基于专业知识和图片信息，对原回答进行适度优化，保持专业性和准确性，避免过度发挥。
                            """
    }
}

# 全局数据库连接变量
db_engine = None
db_session = None

# 自定义 JSON 编码器，处理 datetime 类型
class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        return super().default(obj)

# 替换 Flask 的 JSON 编码器
api.json_encoder = CustomJSONEncoder

# 全局变量存储上传的数据
uploaded_data = {
    'questions': [],
    'replies': [],
    'images': []
}

@api.route('/health', methods=['GET'])
def health_check():
    """健康检查接口"""
    return jsonify({'status': 'ok', 'message': '服务运行正常'})

@api.route('/connect-db', methods=['POST'])
def connect_database():
    """
    连接数据库接口
    
    请求体:
    {
        "host": "localhost",
        "port": 3306,
        "user": "root",
        "password": "password",
        "database": "mydb"
    }
    """
    global db_session, db_engine
    
    try:
        config = request.json
        if not config:
            return jsonify({'error': '请提供数据库配置'}), 400
        
        # 更新配置
        from config.database import DB_CONFIG
        DB_CONFIG.update(config)
        
        # 重新创建连接
        db_engine, db_session = create_engine_and_session()
        
        # 测试连接
        db_session.query(Question).first()
        
        return jsonify({
            'success': True,
            'message': '数据库连接成功'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/score-database', methods=['POST'])
def score_from_database():
    """
    从数据库读取数据并评分
    """
    global db_session
    
    try:
        if not db_session:
            db_engine, db_session = create_engine_and_session()
        
        # 先回滚可能失败的事务
        try:
            db_session.rollback()
        except:
            pass
        
        # 查询所有数据
        replies = db_session.query(Reply).all()
        questions = db_session.query(Question).all()
        images = db_session.query(Image).all()
        
        # 转换为字典
        replies_list = [r.to_dict() for r in replies]
        questions_list = [q.to_dict() for q in questions]
        images_list = [i.to_dict() for i in images]
        
        # 评分并更新数据库
        scored_replies = score_all_replies(replies_list, db_session)
        
        # 为每个问题选择最佳回复，并更新到optimize_data表
        from services.scoring import get_best_reply_for_question
        best_replies = get_best_reply_for_question(scored_replies, db_session)
        
        return jsonify({
            'success': True,
            'message': f'已完成评分和最佳回复选择，共处理 {len(scored_replies)} 条回复，为 {len(best_replies)} 个问题选择了最佳回复',
            'data': {
                'questions_count': len(questions_list),
                'replies_count': len(scored_replies),
                'images_count': len(images_list),
                'best_replies_count': len(best_replies),
                'questions': questions_list,
                'replies': scored_replies,
                'images': images_list
            }
        })
    
    except Exception as e:
        # 发生错误时回滚事务
        if db_session:
            try:
                db_session.rollback()
            except:
                pass
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/score-excel-data', methods=['POST'])
def score_excel_data():
    """
    对 Excel 数据进行评分
    """
    import logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)
    
    try:
        data = request.json
        
        if not data or 'replies' not in data:
            logger.error('未找到回复数据')
            return jsonify({'error': '未找到回复数据'}), 400
        
        replies = data.get('replies', [])
        logger.info(f"开始评分 Excel 数据，共 {len(replies)} 条回复")
        
        # 评分
        scored_replies = score_all_replies(replies)
        
        logger.info(f"评分完成，共处理 {len(scored_replies)} 条回复")
        
        return jsonify({
            'success': True,
            'message': f'已完成评分，共处理 {len(scored_replies)} 条回复',
            'data': {
                'replies_count': len(scored_replies),
                'replies': scored_replies
            }
        })
    
    except Exception as e:
        logger.error(f"评分过程出错: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/upload-excel', methods=['POST'])
def upload_excel():
    """
    上传 Excel 文件并解析（支持单文件累积上传）
    """
    import logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)
    
    global uploaded_data
    
    try:
        logger.info("[Excel上传] 开始处理Excel文件上传")
        
        if 'file' not in request.files:
            logger.error("[Excel上传] 未找到上传文件")
            return jsonify({'error': '未找到上传文件'}), 400
        
        file = request.files['file']
        if file.filename == '':
            logger.error("[Excel上传] 文件名为空")
            return jsonify({'error': '文件名为空'}), 400
        
        # 保存文件
        file_content = file.read()
        file_size = len(file_content) / 1024  # 转换为KB
        logger.info(f"[Excel上传] 收到文件: {file.filename}, 大小: {file_size:.2f} KB")
        # 重置文件指针
        file.seek(0)
        
        file_path = save_uploaded_file(file_content, file.filename)
        logger.info(f"[Excel上传] 文件已保存")
        
        # 解析单个 Excel 文件
        table_type, table_data = parse_single_excel_file(file_path, file.filename)
        logger.info(f"[Excel上传] 解析完成，表类型: {table_type}, 记录数: {len(table_data)}")
        
        # 存储到数据库
        logger.info(f"[Excel上传] 开始存储到数据库...")
        from models.models import get_db_session, init_db
        from sqlalchemy import text
        
        # 初始化数据库表
        logger.info(f"[Excel上传] 初始化数据库表...")
        init_db()
        
        session = get_db_session()
        
        try:
            # 批量处理大小
            batch_size = 1000
            total_records = len(table_data)
            processed_records = 0
            
            logger.info(f"[Excel上传] 开始批量处理，总记录数: {total_records}, 批量大小: {batch_size}")
            
            if table_type == 'questions':
                # 批量存储问题数据
                for i in range(0, total_records, batch_size):
                    batch = table_data[i:i+batch_size]
                    batch_processed = 0
                    
                    try:
                        with session.begin():
                            for item in batch:
                                # 确保 question_no 是字符串类型
                                question_no = str(item.get('question_no')) if item.get('question_no') is not None else None
                                if not question_no:
                                    continue
                                
                                quiz_desc = item.get('quiz_desc') or item.get('question') or ''
                                
                                # 尝试更新
                                update_sql = text("""
                                    UPDATE test.questions 
                                    SET quiz_desc = :quiz_desc 
                                    WHERE question_no = :question_no
                                """)
                                result = session.execute(update_sql, {
                                    'quiz_desc': quiz_desc,
                                    'question_no': question_no
                                })
                                
                                # 如果没有更新任何记录，则插入
                                if result.rowcount == 0:
                                    insert_sql = text("""
                                        INSERT INTO test.questions (question_no, quiz_desc) 
                                        VALUES (:question_no, :quiz_desc)
                                    """)
                                    session.execute(insert_sql, {
                                        'question_no': question_no,
                                        'quiz_desc': quiz_desc
                                    })
                                
                                batch_processed += 1
                                processed_records += 1
                        
                        logger.info(f"[Excel上传] 批量处理完成，处理记录数: {batch_processed}, 累计处理: {processed_records}/{total_records}")
                    except Exception as e:
                        logger.warning(f"[Excel上传] 处理问题批次时出错: {str(e)}")
                        continue
            
            elif table_type == 'replies':
                # 批量存储回复数据
                for i in range(0, total_records, batch_size):
                    batch = table_data[i:i+batch_size]
                    batch_processed = 0
                    
                    try:
                        with session.begin():
                            for item in batch:
                                # 确保 reply_no 和 question_no 是字符串类型
                                reply_no = str(item.get('reply_no')) if item.get('reply_no') is not None else None
                                question_no = str(item.get('question_no')) if item.get('question_no') is not None else None
                                if not reply_no or not question_no:
                                    continue
                                
                                content = item.get('content') or item.get('reply') or ''
                                accepted_flag = item.get('accepted_flag', 0)
                                user_type = item.get('user_type', 1)
                                score = item.get('score')
                                
                                # 尝试更新
                                update_sql = text("""
                                    UPDATE test.replies 
                                    SET question_no = :question_no, content = :content, 
                                        accepted_flag = :accepted_flag, user_type = :user_type, 
                                        score = :score 
                                    WHERE reply_no = :reply_no
                                """)
                                result = session.execute(update_sql, {
                                    'reply_no': reply_no,
                                    'question_no': question_no,
                                    'content': content,
                                    'accepted_flag': accepted_flag,
                                    'user_type': user_type,
                                    'score': score
                                })
                                
                                # 如果没有更新任何记录，则插入
                                if result.rowcount == 0:
                                    insert_sql = text("""
                                        INSERT INTO test.replies (reply_no, question_no, content, 
                                                           accepted_flag, user_type, score) 
                                        VALUES (:reply_no, :question_no, :content, 
                                                :accepted_flag, :user_type, :score)
                                    """)
                                    session.execute(insert_sql, {
                                        'reply_no': reply_no,
                                        'question_no': question_no,
                                        'content': content,
                                        'accepted_flag': accepted_flag,
                                        'user_type': user_type,
                                        'score': score
                                    })
                                
                                batch_processed += 1
                                processed_records += 1
                        
                        logger.info(f"[Excel上传] 批量处理完成，处理记录数: {batch_processed}, 累计处理: {processed_records}/{total_records}")
                    except Exception as e:
                        logger.warning(f"[Excel上传] 处理回复批次时出错: {str(e)}")
                        continue
            
            elif table_type == 'images':
                # 批量存储图片数据
                logger.info(f"[Excel上传] 图片表数据示例: {table_data[0] if table_data else '空'}")
                logger.info(f"[Excel上传] 图片表字段: {list(table_data[0].keys()) if table_data else '无'}")
                
                for i in range(0, total_records, batch_size):
                    batch = table_data[i:i+batch_size]
                    batch_processed = 0
                    skipped = 0
                    
                    try:
                        with session.begin():
                            for item in batch:
                                # 确保 entity_id 是字符串类型，使用 question_no 作为 entity_id
                                # 只处理必要的字段，忽略 image_id 和 create_time
                                entity_id = str(item.get('question_no')) if item.get('question_no') is not None else None
                                url = item.get('url')
                                
                                # 记录被跳过的原因
                                if not entity_id:
                                    skipped += 1
                                    continue
                                if not url:
                                    skipped += 1
                                    continue
                                
                                # 检查是否已存在
                                check_sql = text("""
                                    SELECT 1 FROM test.images 
                                    WHERE entity_id = :entity_id AND url = :url
                                """)
                                result = session.execute(check_sql, {
                                    'entity_id': entity_id,
                                    'url': url
                                }).fetchone()
                                
                                # 如果不存在，则插入
                                if not result:
                                    insert_sql = text("""
                                        INSERT INTO test.images (entity_id, url) 
                                        VALUES (:entity_id, :url)
                                    """)
                                    session.execute(insert_sql, {
                                        'entity_id': entity_id,
                                        'url': url
                                    })
                                    batch_processed += 1
                                    processed_records += 1
                                else:
                                    skipped += 1
                        
                        logger.info(f"[Excel上传] 批量处理完成，处理记录数: {batch_processed}, 跳过记录数: {skipped}, 累计处理: {processed_records}/{total_records}")
                    except Exception as e:
                        logger.warning(f"[Excel上传] 处理图片批次时出错: {str(e)}")
                        continue
            
            logger.info(f"[Excel上传] 数据已存储到数据库，总处理记录数: {processed_records}")
        finally:
            if session:
                session.close()
        
        # 更新上传数据（只存储编号等简洁信息）
        if table_type == 'questions':
            uploaded_data[table_type] = [{"question_no": item.get("question_no")} for item in table_data]
        elif table_type == 'replies':
            uploaded_data[table_type] = [{"reply_no": item.get("reply_no"), "question_no": item.get("question_no")} for item in table_data]
        elif table_type == 'images':
            uploaded_data[table_type] = [{"entity_id": item.get("entity_id"), "url": item.get("url")} for item in table_data]
        
        # 检查所有表是否已上传
        upload_status = {
            'questions': len(uploaded_data['questions']) > 0,
            'replies': len(uploaded_data['replies']) > 0,
            'images': len(uploaded_data['images']) > 0
        }
        
        # 检查是否所有表都已上传
        all_ready = all(upload_status.values())
        
        # 构建消息
        if all_ready:
            message = '所有表上传成功，数据已就绪，请点击评分按钮开始评分'
            logger.info("[Excel上传] 所有表已上传完成，数据就绪")
            logger.info(f"[Excel上传] 统计: 问题{len(uploaded_data['questions'])}条, 回复{len(uploaded_data['replies'])}条, 图片{len(uploaded_data['images'])}条")
        else:
            missing = [k for k, v in upload_status.items() if not v]
            message = f'已上传 {table_type} 表，还需上传: {"、".join(missing)}'
            logger.info(f"[Excel上传] 部分表已上传，还需上传: {missing}")
        
        # 清理 NaN 值（Pandas 读取 Excel 时会将空值转换为 NaN）
        def clean_nan_values(obj):
            """递归清理 NaN 值"""
            import math
            
            if isinstance(obj, dict):
                return {k: clean_nan_values(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [clean_nan_values(item) for item in obj]
            elif isinstance(obj, float) and math.isnan(obj):
                return None
            else:
                return obj
        
        # 准备返回数据
        response_data = {
            'success': True,
            'message': message,
            'data': {
                'upload_status': upload_status,
                'all_ready': all_ready,
                'table_type': table_type,
                'table_count': len(table_data),
                'questions_count': len(uploaded_data['questions']),
                'replies_count': len(uploaded_data['replies']),  # 始终返回实际记录数
                'images_count': len(uploaded_data['images']),
                'questions': clean_nan_values(uploaded_data['questions']) if all_ready else [],
                'replies': clean_nan_values(uploaded_data['replies']) if all_ready else [],
                'images': clean_nan_values(uploaded_data['images']) if all_ready else []
            }
        }
        
        logger.info("[Excel上传] 处理完成")
        return jsonify(response_data)
    
    except Exception as e:
        logger.error(f"[Excel上传] 发生异常: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/reset-upload', methods=['POST'])
def reset_upload():
    """
    重置上传的数据
    """
    global uploaded_data
    
    uploaded_data = {
        'questions': [],
        'replies': [],
        'images': []
    }
    
    return jsonify({
        'success': True,
        'message': '已重置上传数据'
    })

@api.route('/get-upload-status', methods=['GET'])
def get_upload_status():
    """
    获取当前上传状态
    """
    global uploaded_data
    
    upload_status = {
        'questions': len(uploaded_data['questions']) > 0,
        'replies': len(uploaded_data['replies']) > 0,
        'images': len(uploaded_data['images']) > 0
    }
    
    all_ready = all(upload_status.values())
    
    # 不再自动评分，等待用户点击评分按钮
    
    return jsonify({
        'success': True,
        'data': {
            'upload_status': upload_status,
            'all_ready': all_ready,
            'questions_count': len(uploaded_data['questions']),
            'replies_count': len(uploaded_data['replies']),
            'images_count': len(uploaded_data['images']),
            'questions': uploaded_data['questions'],
            'replies': uploaded_data['replies'],
            'images': uploaded_data['images']
        }
    })

@api.route('/export-database', methods=['POST'])
def export_database_data():
    """
    从数据库导出训练数据（先评分再导出）
    """
    global db_session
    
    try:
        if not db_session:
            db_engine, db_session = create_engine_and_session()
        
        # 先回滚可能失败的事务
        try:
            db_session.rollback()
        except:
            pass
        
        # 查询所有数据
        replies = db_session.query(Reply).all()
        questions = db_session.query(Question).all()
        images = db_session.query(Image).all()
        
        # 转换为字典
        replies_list = [r.to_dict() for r in replies]
        questions_list = [q.to_dict() for q in questions]
        images_list = [i.to_dict() for i in images]
        
        # 直接使用数据库中已有的评分，不重复评分
        # 注意：确保数据库中的回复已经通过 score_from_database 接口进行过评分
        
        # 使用数据库中的评分数据导出
        from services.export import prepare_training_data, save_training_data
        training_data = prepare_training_data(questions_list, replies_list, images_list, db_session)
        output_path = save_training_data(training_data)
        
        return jsonify({
            'success': True,
            'message': f'导出成功，共 {len(training_data)} 条训练数据',
            'download_url': f'/download/{os.path.basename(output_path)}',
            'filename': os.path.basename(output_path)
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/export-excel-data', methods=['POST'])
def export_excel_data():
    """
    从上传的 Excel 数据导出训练数据
    """
    import logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)
    
    try:
        data = request.json
        
        if not data:
            logger.error('未找到数据')
            return jsonify({'error': '未找到数据'}), 400
        
        questions = data.get('questions', [])
        replies = data.get('replies', [])
        images = data.get('images', [])
        
        logger.info(f"开始导出训练数据，问题数: {len(questions)}, 回复数: {len(replies)}, 图片数: {len(images)}")
        
        # 准备训练数据
        training_data = prepare_training_data(questions, replies, images)
        
        logger.info(f"训练数据准备完成，共 {len(training_data)} 条")
        
        # 导出到文件
        output_path = export_to_json(training_data)
        
        logger.info(f"导出完成，文件路径: {output_path}")
        
        return jsonify({
            'success': True,
            'message': f'导出成功，共 {len(training_data)} 条训练数据',
            'download_url': f'/download/{os.path.basename(output_path)}',
            'filename': os.path.basename(output_path)
        })
    
    except Exception as e:
        logger.error(f"导出过程出错: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/preview-data', methods=['POST'])
def preview_data():
    """
    预览数据库数据
    """
    global db_session
    
    try:
        if not db_session:
            db_engine, db_session = create_engine_and_session()
        
        # 先回滚可能失败的事务
        try:
            db_session.rollback()
        except:
            pass
        
        # 查询样本数据
        questions_sample = db_session.query(Question).all()
        replies_sample = db_session.query(Reply).all()
        # 查询所有图片数据，确保完整匹配
        images_sample = db_session.query(Image).all()
        
        # 转换为字典
        questions_list = [q.to_dict() for q in questions_sample]
        replies_list = [r.to_dict() for r in replies_sample]
        images_list = [i.to_dict() for i in images_sample]
        
        # 直接返回原始数据，不进行评分
        # 评分操作应该由专门的评分 API 处理
        
        return jsonify({
            'success': True,
            'data': {
                'questions': questions_list,
                'replies': replies_list,
                'images': images_list
            }
        })
    
    except Exception as e:
        # 发生错误时回滚事务
        if db_session:
            try:
                db_session.rollback()
            except:
                pass
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/get-models', methods=['GET'])
def get_models():
    """
    获取阿里云 Qwen 最新的模型名称
    """
    try:
        # 这里返回模拟的模型列表
        # 实际应用中，应该调用阿里云 API 获取最新的模型列表
        models = {
            'text_models': [
                {'value': 'qwen3.5-plus', 'label': 'qwen3.5-plus'},
                {'value': 'qwen3.5', 'label': 'qwen3.5'},
                {'value': 'qwen3-max', 'label': 'qwen3-max'},
                {'value': 'qwen3.5-flash', 'label': 'qwen3.5-flash'}
            ],
            'vl_models': [
                {'value': 'qwen3-vl-plus', 'label': 'qwen3-vl-plus'},
                {'value': 'qwen3-vl-flash', 'label': 'qwen3-vl-flash'},
                {'value': 'qwen-image-2.0', 'label': 'qwen-image-2.0'},
                {'value': 'qwen-image-2.0-pro', 'label': 'qwen-image-2.0-pro'},
                {'value': 'qwen-image-max', 'label': 'qwen-image-max'},
                {'value': 'qwen-image-plus', 'label': 'qwen-image-plus'},
                {'value': 'qwen-image-edit-max', 'label': 'qwen-image-edit-max'},
                {'value': 'qwen-image-edit-plus', 'label': 'qwen-image-edit-plus'},
                {'value': 'z-image-turbo', 'label': 'z-image-turbo'},
                {'value': 'wan-12v', 'label': 'wan-12v'}
            ]
        }
        
        return jsonify({
            'success': True,
            'data': models
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/analyze-similarity', methods=['POST'])
def analyze_similarity():
    """
    分析文本优化和多模态优化结果的相似度，只处理指定问题编号的数据
    """
    # 增加请求超时设置
    from flask import request
    import time
    
    try:
        data = request.json
        
        if not data:
            logger.warning("未找到数据")
            return jsonify({'error': '未找到数据'}), 400
        
        question_nos = data.get('question_nos', [])
        
        if not question_nos:
            logger.warning("缺少问题编号参数")
            return jsonify({'error': '未指定问题编号，请先进行评分操作'}), 400
        
        # 从数据库读取数据
        from models.models import create_engine_and_session
        from sqlalchemy import text
        engine, session = create_engine_and_session()
        
        # 查询 optimize_data 表
        if question_nos:
            # 构建查询条件，只查询指定的问题编号
            placeholders = ', '.join([':q' + str(i) for i in range(len(question_nos))])
            params = {f'q{i}': q for i, q in enumerate(question_nos)}
            
            optimize_data_query = text(f"""
                SELECT question_no, question, answer, text_optimized_question, text_optimized_answer, optimized_question, optimized_answer
                FROM test.optimize_data
                WHERE question IS NOT NULL AND answer IS NOT NULL
                AND question_no IN ({placeholders})
            """)
            optimize_data_result = session.execute(optimize_data_query, params)
        else:
            # 如果没有指定问题编号，返回错误
            session.close()
            return jsonify({'error': '未指定问题编号，请先进行评分操作'}), 400
        
        # 构建 optimize_data 列表
        optimize_data_list = []
        
        for row in optimize_data_result:
            optimize_data_list.append({
                'question_no': row.question_no,
                'question': row.question,
                'answer': row.answer,
                'text_optimized_question': row.text_optimized_question,
                'text_optimized_answer': row.text_optimized_answer,
                'optimized_question': row.optimized_question,
                'optimized_answer': row.optimized_answer
            })
        
        # 关闭数据库会话
        session.close()
        
        # 执行相似度分析
        from services.similarity import analyze_similarity_directly
        analysis_result = analyze_similarity_directly(optimize_data_list)
        
        # 构建下载链接
        all_entries_filename = os.path.basename(analysis_result['all_entries_path'])
        training_format_filename = os.path.basename(analysis_result['training_format_path'])
        
        # 提取问题编号列表
        question_nos = analysis_result.get('all_question_nos', [])
        high_similarity_question_nos = analysis_result.get('high_similarity_question_nos', [])
        
        return jsonify({
            'success': True,
            'message': f'相似度分析完成，共分析 {analysis_result["all_entries_count"]} 条数据',
            'data': {
                'high_similarity_count': analysis_result['high_similarity_count'],
                'all_entries_count': analysis_result['all_entries_count'],
                'training_format_count': analysis_result['training_format_count'],
                'all_entries_download_url': f'/download/{all_entries_filename}',
                'all_entries_filename': all_entries_filename,
                'training_format_download_url': f'/download/{training_format_filename}',
                'training_format_filename': training_format_filename,
                'all_question_nos': question_nos,
                'high_similarity_question_nos': high_similarity_question_nos
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/get-images-by-entity-id', methods=['POST'])
def get_images_by_entity_id():
    """
    根据entity_id查询图片信息并生成预签名URL
    """
    try:
        data = request.json
        entity_id = data.get('entity_id')
        
        print(f"[图片查询] 接收到请求，entity_id: {entity_id}")
        
        if not entity_id:
            print("[图片查询] 缺少entity_id参数")
            return jsonify({'success': False, 'error': '缺少entity_id参数'}), 400
        
        db_engine = None
        db_session = None
        
        try:
            # 直接创建数据库连接
            print("[图片查询] 正在创建数据库连接...")
            db_engine, db_session = create_engine_and_session()
            print("[图片查询] 数据库连接成功")
            
            # 测试连接
            try:
                db_session.rollback()
                print("[图片查询] 数据库连接测试成功")
            except Exception as test_error:
                print(f"[图片查询] 数据库连接测试失败: {test_error}")
            
            # 查询所有entity_id匹配的图片
            print(f"[图片查询] 正在查询entity_id={entity_id}的图片...")
            images = db_session.query(Image).filter(Image.entity_id == entity_id).all()
            print(f"[图片查询] 查询结果: 找到 {len(images)} 张图片")
            
            # 生成预签名URL
            image_urls = []
            for img in images:
                try:
                    print(f"[图片查询] 处理图片: id={img.entity_id}, url={img.url}")
                    # 从URL中提取对象路径
                    # 假设URL格式为：http://minio-endpoint/bucket/object-path 或直接存储对象路径
                    url = img.url
                    object_name = url
                    
                    # 处理URL，考虑remote_path配置
                    if url.startswith('http://') or url.startswith('https://'):
                        # 如果是完整URL，提取对象路径
                        print(f"[图片查询] 处理完整URL: {url}")
                        path = url.split('://')[-1].split('/')
                        print(f"[图片查询] URL路径分解: {path}")
                        # 跳过域名和browser部分，获取bucket和对象路径
                        if len(path) > 3:
                            # 格式：http://minio-endpoint/browser/bucket/object-path
                            object_name = '/'.join(path[3:])
                            print(f"[图片查询] 提取对象路径: {object_name}")
                        elif len(path) == 3:
                            # 格式：http://minio-endpoint/browser/bucket
                            object_name = ''
                            print(f"[图片查询] 提取对象路径: {object_name}")
                        elif len(path) == 2:
                            # 格式：http://minio-endpoint/browser
                            object_name = ''
                            print(f"[图片查询] 提取对象路径: {object_name}")
                    else:
                        # 如果是相对路径，添加remote_path前缀
                        remote_path = MINIO_CONFIG.get('remote_path', '')
                        object_name = f"{remote_path.rstrip('/')}/{url.lstrip('/')}"
                        print(f"[图片查询] 处理相对路径，添加remote_path: {object_name}")
                    
                    # 生成7天过期的预签名URL
                    print(f"[图片查询] 生成预签名URL，bucket={MINIO_CONFIG['bucket_name']}, object_name={object_name}")
                    presigned_url = minio_client.presigned_get_object(
                        MINIO_CONFIG['bucket_name'],
                        object_name,
                        expires=timedelta(seconds=604800)  # 7天，单位秒
                    )
                    print(f"[图片查询] 预签名URL生成成功: {presigned_url[:100]}...")
                    image_urls.append({'url': presigned_url})
                except S3Error as e:
                    print(f"[图片查询] 生成预签名URL失败: {e}")
                    # 失败时使用原始URL作为备选
                    image_urls.append({'url': img.url})
                except Exception as e:
                    print(f"[图片查询] 处理图片URL时出错: {e}")
                    import traceback
                    traceback.print_exc()
                    # 失败时使用原始URL作为备选
                    image_urls.append({'url': img.url})
            
            print(f"[图片查询] 处理完成，返回 {len(image_urls)} 个图片URL")
            return jsonify({
                'success': True,
                'data': image_urls
            })
        except Exception as db_error:
            print(f"[图片查询] 数据库操作失败: {db_error}")
            import traceback
            traceback.print_exc()
            return jsonify({'success': False, 'error': str(db_error)}), 500
        finally:
            # 确保数据库连接正确关闭
            if db_session:
                try:
                    db_session.close()
                    print("[图片查询] 数据库会话已关闭")
                except Exception as e:
                    print(f"[图片查询] 关闭数据库会话时出错: {e}")
            if db_engine:
                try:
                    db_engine.dispose()
                    print("[图片查询] 数据库引擎已关闭")
                except Exception as e:
                    print(f"[图片查询] 关闭数据库引擎时出错: {e}")
    except Exception as e:
        print(f"[图片查询] 请求处理失败: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/get-default-prompts', methods=['GET'])
def get_default_prompts():
    """
    获取默认提示词
    """
    try:
        # 获取模型类型参数
        model_type = request.args.get('model_type', 'text')
        
        # 从集中配置中获取默认提示词
        question_prompt = DEFAULT_PROMPTS.get(model_type, DEFAULT_PROMPTS['text'])['question']
        answer_prompt = DEFAULT_PROMPTS.get(model_type, DEFAULT_PROMPTS['text'])['answer']
        
        return jsonify({
            'success': True,
            'data': {
                'question_prompt': question_prompt,
                'answer_prompt': answer_prompt
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/download/<filename>', methods=['GET'])
def download_file(filename):
    """
    下载文件
    
    参数:
        filename: 要下载的文件名
    """
    try:
        # 确保文件名安全，避免路径遍历攻击
        import os
        safe_filename = os.path.basename(filename)
        
        # 构建完整的文件路径
        file_path = os.path.join(OUTPUT_FOLDER, safe_filename)
        
        # 检查文件是否存在
        if not os.path.exists(file_path):
            return jsonify({
                'success': False,
                'error': '文件不存在'
            }), 404
        
        # 提供文件下载
        from flask import send_file
        return send_file(file_path, as_attachment=True, download_name=safe_filename)
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/get-review-data', methods=['POST'])
def get_review_data():
    """
    获取审查数据
    
    请求体:
        {
            "question_nos": ["123", "456", "789"],  # 问题编号列表
            "page": 1,  # 页码
            "page_size": 50  # 每页数量
        }
    """
    try:
        import traceback
        from flask import current_app
        logger = current_app.logger
        
        data = request.json
        question_nos = data.get('question_nos', [])
        page = data.get('page', 1)
        page_size = data.get('page_size', 50)
        
        logger.info(f"收到获取审查数据请求，问题编号数量: {len(question_nos)}")
        
        if not question_nos:
            logger.warning("未提供问题编号列表")
            return jsonify({
                'success': False,
                'error': '请提供问题编号列表'
            }), 400
        
        # 计算分页参数
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_question_nos = question_nos[start_idx:end_idx]
        
        logger.info(f"分页后问题编号数量: {len(paginated_question_nos)}")
        
        if not paginated_question_nos:
            logger.info("分页后问题编号列表为空")
            return jsonify({
                'success': True,
                'data': [],
                'total': len(question_nos),
                'page': page,
                'page_size': page_size
            })
        
        # 从数据库读取数据
        from models.models import create_engine_and_session
        from sqlalchemy import text
        
        engine = None
        session = None
        
        try:
            logger.info("开始创建数据库连接")
            engine, session = create_engine_and_session()
            
            # 查询 optimize_data 表
            placeholders = ', '.join([':q' + str(i) for i in range(len(paginated_question_nos))])
            params = {f'q{i}': q for i, q in enumerate(paginated_question_nos)}
            
            logger.info(f"构建 SQL 查询，问题编号数量: {len(paginated_question_nos)}")
            
            optimize_data_query = text(f"""
                SELECT question_no, question, answer, text_optimized_question, text_optimized_answer, optimized_question, optimized_answer, high, review_status, qa_similarity
                FROM test.optimize_data
                WHERE question_no IN ({placeholders})
            """)
            
            logger.info("执行 SQL 查询")
            optimize_data_result = session.execute(optimize_data_query, params)
            
            # 构建结果列表
            result = []
            for row in optimize_data_result:
                # 按照指定顺序构建字典
                result.append({
                    'id_value': row.question_no,
                    'question': row.question,
                    'answer': row.answer,
                    'text_optimized_question': row.text_optimized_question,
                    'text_optimized_answer': row.text_optimized_answer,
                    'optimized_question': row.optimized_question,
                    'optimized_answer': row.optimized_answer,
                    'high': row.high,
                    'reviewStatus': row.review_status,
                    'qa_similarity': row.qa_similarity
                })
            
            logger.info(f"查询完成，返回数据数量: {len(result)}")
            
        finally:
            # 确保数据库会话和引擎关闭
            if session:
                try:
                    session.close()
                    logger.info("数据库会话已关闭")
                except Exception as e:
                    logger.error(f"关闭数据库会话时出错: {e}")
            if engine:
                try:
                    engine.dispose()
                    logger.info("数据库引擎已关闭")
                except Exception as e:
                    logger.error(f"关闭数据库引擎时出错: {e}")
        
        return jsonify({
            'success': True,
            'data': result,
            'total': len(question_nos),
            'page': page,
            'page_size': page_size
        })
    except Exception as e:
        import traceback
        from flask import current_app
        logger = current_app.logger
        logger.error(f"获取审查数据时出错: {e}")
        logger.error(f"错误堆栈: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/get-review-detail/<question_no>', methods=['GET'])
def get_review_detail(question_no):
    """
    获取单个问题的审查详情
    
    参数:
        question_no: 问题编号
    """
    try:
        if not question_no:
            return jsonify({
                'success': False,
                'error': '请提供问题编号'
            }), 400
        
        # 从数据库读取数据
        from models.models import create_engine_and_session
        from sqlalchemy import text
        engine, session = create_engine_and_session()
        
        # 查询 optimize_data 表
        optimize_data_query = text("""
            SELECT question_no, question, answer, text_optimized_question, text_optimized_answer, optimized_question, optimized_answer, high, review_status
            FROM test.optimize_data
            WHERE question_no = :question_no
        """)
        optimize_data_result = session.execute(optimize_data_query, {'question_no': question_no})
        
        # 获取结果
        row = optimize_data_result.fetchone()
        if not row:
            session.close()
            return jsonify({
                'success': False,
                'error': '未找到该问题的数据'
            }), 404
        
        # 构建结果
        result = {
            'question_no': row.question_no,
            'question': row.question,
            'answer': row.answer,
            'text_optimized_question': row.text_optimized_question,
            'text_optimized_answer': row.text_optimized_answer,
            'optimized_question': row.optimized_question,
            'optimized_answer': row.optimized_answer,
            'high': row.high,
            'review_status': row.review_status
        }
        
        # 关闭数据库会话和引擎
        session.close()
        engine.dispose()
        
        return jsonify({
            'success': True,
            'data': result
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/update-review-status', methods=['POST'])
def update_review_status():
    """
    更新审核状态
    
    请求体:
        {
            "review_items": [
                {"question_no": "123", "review_status": 2},  # 2表示已通过
                {"question_no": "456", "review_status": 3}   # 3表示需修改
            ]
        }
    """
    try:
        data = request.json
        review_items = data.get('review_items', [])
        
        if not review_items:
            return jsonify({
                'success': False,
                'error': '请提供审核状态更新列表'
            }), 400
        
        # 从数据库更新状态
        from models.models import create_engine_and_session
        from sqlalchemy import text
        engine, session = create_engine_and_session()
        
        # 批量更新审核状态
        for item in review_items:
            question_no = item.get('question_no')
            review_status = item.get('review_status')
            
            if question_no and review_status:
                update_query = text("""
                    UPDATE test.optimize_data
                    SET review_status = :review_status
                    WHERE question_no = :question_no
                """)
                session.execute(update_query, {
                    "review_status": review_status,
                    "question_no": question_no
                })
        
        # 提交事务
        session.commit()
        # 关闭数据库会话和引擎
        session.close()
        engine.dispose()
        
        return jsonify({
            'success': True,
            'message': f'成功更新 {len(review_items)} 条审核状态'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 导入缓存相关模块
from functools import lru_cache
import hashlib

# 缓存键生成函数
def generate_cache_key(question_nos):
    """生成缓存键"""
    # 对问题编号列表排序后生成哈希值，确保相同的问题编号列表生成相同的缓存键
    import hashlib
    sorted_nos = sorted(question_nos)
    nos_str = ','.join(sorted_nos)
    return hashlib.md5(nos_str.encode()).hexdigest()

# 缓存装饰器，缓存批量查询结果
from functools import lru_cache
@lru_cache(maxsize=1000)  # 最多缓存1000个结果
def cached_batch_query(question_nos_tuple):
    """
    缓存的批量查询函数
    
    参数:
        question_nos_tuple: 问题编号元组（因为列表不能作为缓存键）
    
    返回:
        包含问题、回复和优化数据的字典
    """
    global db_session
    
    if not db_session:
        db_engine, db_session = create_engine_and_session()
    
    question_nos = list(question_nos_tuple)
    
    # 批量查询问题
    questions = db_session.query(Question).filter(Question.question_no.in_(question_nos)).all()
    questions_list = [q.to_dict() for q in questions]
    
    # 批量查询回复
    replies = db_session.query(Reply).filter(Reply.question_no.in_(question_nos)).all()
    replies_list = [r.to_dict() for r in replies]
    
    # 批量查询 optimize_data（添加错误处理）
    optimize_data_list = []
    try:
        from sqlalchemy import text
        # 使用 ANY 操作符来正确处理 PostgreSQL 的数组参数
        optimize_data_query = text("SELECT * FROM test.optimize_data WHERE question_no = ANY(:question_nos)")
        optimize_data_result = db_session.execute(optimize_data_query, {'question_nos': question_nos})
        optimize_data_list = [dict(row._mapping) for row in optimize_data_result]
    except Exception as e:
        logging.error(f"查询 optimize_data 表失败: {e}")
    
    return {
        'questions': questions_list,
        'replies': replies_list,
        'optimize_data': optimize_data_list
    }

@api.route('/batch-query', methods=['POST'])
def batch_query():
    """
    批量查询问题和回复的详细信息
    
    请求体:
        {
            "question_nos": ["123", "456", "789"]  # 问题编号列表
        }
    
    返回:
        {
            "success": true,
            "data": {
                "questions": [...],  # 问题详细信息
                "replies": [...],    # 回复详细信息
                "optimize_data": [...]  # 优化数据详细信息
            }
        }
    """
    try:
        # 获取请求体
        data = request.get_json()
        question_nos = data.get('question_nos', [])
        
        if not question_nos:
            return jsonify({
                'success': False,
                'error': '请提供问题编号列表'
            }), 400
        
        # 将列表转换为元组，以便作为缓存键
        question_nos_tuple = tuple(question_nos)
        
        # 使用缓存的查询结果
        data = cached_batch_query(question_nos_tuple)
        
        return jsonify({
            'success': True,
            'data': data
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api.route('/get-optimize-data', methods=['POST'])
def get_optimize_data():
    """
    直接从test.optimize_data表获取数据
    
    请求体:
        {
            "page": 1,  # 页码
            "page_size": 10,  # 每页数量
            "filters": {
                "status": "",  # 审核状态筛选
                "search": ""  # 搜索关键词
            }
        }
    """
    try:
        import logging
        from models.models import get_db_session
        from sqlalchemy import text
        
        # 配置日志
        if not logging.getLogger().hasHandlers():
            logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        logger = logging.getLogger(__name__)
        
        data = request.json
        page = data.get('page', 1)
        page_size = data.get('page_size', 10)
        filters = data.get('filters', {})
        status_filter = filters.get('status', '')
        quality_filter = filters.get('quality', '')
        search_filter = filters.get('search', '')
        
        logger.info(f"收到获取optimize_data请求，页码: {page}, 每页数量: {page_size}, 状态筛选: {status_filter}, 质量等级筛选: {quality_filter}, 搜索关键词: {search_filter}")
        
        # 计算分页参数
        offset = (page - 1) * page_size
        
        # 构建查询条件
        where_conditions = []
        params = {'limit': page_size, 'offset': offset}
        
        # 状态筛选
        if status_filter:
            status_map = {
                'pending': 1,
                'approved': 2,
                'rejected': 3
            }
            status_value = status_map.get(status_filter)
            if status_value:
                where_conditions.append(f"review_status = :status")
                params['status'] = status_value
        
        # 质量等级筛选
        if quality_filter:
            if quality_filter == 'high':
                where_conditions.append("qa_similarity >= 0.8")
            elif quality_filter == 'medium':
                where_conditions.append("qa_similarity >= 0.7 AND qa_similarity < 0.8")
            elif quality_filter == 'low':
                where_conditions.append("qa_similarity < 0.7")
        
        # 搜索筛选
        if search_filter:
            where_conditions.append("(question_no LIKE :search OR text_optimized_question LIKE :search)")
            params['search'] = f"%{search_filter}%"
        
        # 构建WHERE子句
        where_clause = " WHERE " + " AND ".join(where_conditions) if where_conditions else ""
        
        # 使用数据库连接池
        session = get_db_session()
        
        try:
            # 批量执行查询
            with session.begin():
                # 查询总数据量
                count_query = text(f"SELECT COUNT(*) FROM test.optimize_data{where_clause}")
                total_result = session.execute(count_query, params)
                total = total_result.scalar() or 0
                
                logger.info(f"总数据量: {total}")
                
                # 查询数据
                data_query = text(f"""
                    SELECT question_no, text_optimized_question, qa_similarity, review_status
                    FROM test.optimize_data
                    {where_clause}
                    ORDER BY question_no
                    LIMIT :limit OFFSET :offset
                """)
                
                data_result = session.execute(data_query, params)
                
                # 构建结果列表
                result = []
                for row in data_result:
                    result.append({
                        'question_no': row.question_no,
                        'text_optimized_question': row.text_optimized_question,
                        'qa_similarity': row.qa_similarity,
                        'review_status': row.review_status
                    })
                
                logger.info(f"查询完成，返回数据数量: {len(result)}")
                
        finally:
            # 关闭会话但不关闭引擎（使用连接池）
            if session:
                try:
                    session.close()
                except Exception as e:
                    logger.error(f"关闭数据库会话时出错: {e}")
        
        return jsonify({
            'success': True,
            'data': result,
            'total': total,
            'page': page,
            'page_size': page_size
        })
    except Exception as e:
        import traceback
        logging.error(f"获取optimize_data时出错: {e}")
        logging.error(f"错误堆栈: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@api.route('/optimize-data', methods=['POST'])
def optimize_data():
    """
    优化问答对数据，直接从数据库批量导入
    """
    try:
        data = request.json
        
        if not data:
            return jsonify({'error': '未找到数据'}), 400
        
        text_model = data.get('text_model', 'qwen3')
        vl_model = data.get('vl_model', 'qwen3-vl')
        data_source = data.get('data_source')
        api_key = data.get('api_key', '')
        api_base_url = data.get('api_base_url', 'https://dashscope.aliyuncs.com/compatible-mode/v1')
        text_question_prompt = data.get('question_prompt', '')
        text_answer_prompt = data.get('answer_prompt', '')
        vl_question_prompt = data.get('vl_question_prompt', '')
        vl_answer_prompt = data.get('vl_answer_prompt', '')
        test_mode = data.get('test_mode', False)
        test_count = data.get('test_count', 5)
        batch_size = data.get('batch_size', 1000)  # 每批处理的数量
        question_nos = data.get('question_nos', [])  # 需要优化的问题编号列表
        
        # 从数据库读取数据
        from models.models import create_engine_and_session
        from sqlalchemy import text
        engine, session = create_engine_and_session()
        
        # 直接查询 optimize_data 表
        if question_nos:
            # 构建查询条件，只查询指定的问题编号
            placeholders = ', '.join([':q' + str(i) for i in range(len(question_nos))])
            params = {f'q{i}': q for i, q in enumerate(question_nos)}
            
            optimize_data_query = text(f"""
                SELECT question_no, question, answer, score
                FROM test.optimize_data
                WHERE question IS NOT NULL AND answer IS NOT NULL
                AND question_no IN ({placeholders})
            """)
            optimize_data_result = session.execute(optimize_data_query, params)
        else:
            # 如果没有指定问题编号，返回错误
            session.close()
            return jsonify({'error': '未指定问题编号，请先进行评分操作'}), 400
        
        # 查询图片数据
        image_result = None
        try:
            # 检查 test.images 表是否存在
            check_image_table = text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'images' AND table_schema = 'test')")
            image_table_exists = session.execute(check_image_table).scalar()
            
            if image_table_exists:
                # 构建查询条件，只查询指定问题编号的图片
                placeholders = ', '.join([':q' + str(i) for i in range(len(question_nos))])
                params = {f'q{i}': q for i, q in enumerate(question_nos)}
                
                image_query = text(f"""
                    SELECT entity_id, url
                    FROM test.images
                    WHERE entity_id IN ({placeholders})
                """)
                image_result = session.execute(image_query, params)
            else:
                logging.info("test.images 表不存在，跳过图片查询")
        except Exception as e:
            logging.error(f"查询图片数据失败: {e}")
            image_result = None

        # 按问题编号分组图片
        from collections import defaultdict
        question_images = defaultdict(list)
        if image_result:
            for row in image_result:
                question_images[row.entity_id].append(row.url)
        
        # 构建输入数据
        input_data = []
        for row in optimize_data_result:
            question_no = row.question_no
            question_content = row.question
            answer_content = row.answer
            
            # 构建对话数据
            conversations = [
                {
                    "role": "user",
                    "value": question_content
                },
                {
                    "role": "assistant",
                    "value": answer_content
                }
            ]
            
            # 构建输入数据项
            item = {
                "id": question_no,
                "conversations": conversations
            }
            
            # 添加图片数据
            if question_no in question_images:
                item["image"] = question_images[question_no]
            
            input_data.append(item)
        
        # 只处理多模态数据
        multimodal_data = []
        
        for item in input_data:
            # 检查是否有图片
            has_image = False
            if "image" in item:
                if isinstance(item["image"], list) and len(item["image"]) > 0:
                    has_image = True
                elif isinstance(item["image"], str) and item["image"]:
                    has_image = True
            
            if has_image:
                multimodal_data.append(item)
        
        # 在测试模式下只处理前 test_count 条数据
        if test_mode:
            multimodal_data = multimodal_data[:test_count]
            logging.info(f"测试模式: 只处理前 {test_count} 条多模态数据")
        
        # 关闭数据库会话
        session.close()
        
        # 文本模型优化：去除多模态数据中的图片部分，只对文本进行优化
        text_optimized_data = []
        if multimodal_data:
            # 创建临时文件存储去除图片的文本数据
            import tempfile
            # 复制多模态数据并去除图片部分
            text_only_data = []
            for item in multimodal_data:
                text_item = item.copy()
                # 去除图片部分
                text_item["image"] = []
                # 去除对话中的图片标记
                if "conversations" in text_item:
                    for conv in text_item["conversations"]:
                        if "value" in conv:
                            # 去除图片标记
                            conv["value"] = ' '.join([part for part in conv["value"].split() if not part.startswith('<image>')])
                        if "images" in conv:
                            del conv["images"]
                text_only_data.append(text_item)
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as temp_file:
                json.dump(text_only_data, temp_file)
                temp_file_path = temp_file.name
            
            text_optimized_data = optimize_with_text_model(temp_file_path, text_model, api_key, api_base_url, text_question_prompt, text_answer_prompt, test_mode, test_count, batch_size)
            
            # 删除临时文件
            os.unlink(temp_file_path)
        
        # 多模态优化：基于图片和文本进行优化
        vl_optimized_data = []
        if multimodal_data:
            # 创建临时文件存储多模态数据
            import tempfile
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as temp_file:
                json.dump(multimodal_data, temp_file)
                temp_file_path = temp_file.name
            
            vl_optimized_data = optimize_with_vl_model(temp_file_path, vl_model, api_key, api_base_url, vl_question_prompt, vl_answer_prompt, test_mode, test_count, batch_size)
            
            # 删除临时文件
            os.unlink(temp_file_path)
        
        # 合并优化结果
        total_optimized = len(text_optimized_data) + len(vl_optimized_data)
        
        # 存储优化结果到数据库（测试模式下不存储）
        if not test_mode:
            try:
                from models.models import create_engine_and_session
                engine, session = create_engine_and_session()
                from sqlalchemy import text
                
                # 存储文本优化结果
                for item in text_optimized_data:
                    question_no = item.get('id')
                    if question_no:
                        optimized_question = item.get('conversations', [{}])[0].get('value', '')
                        optimized_answer = item.get('conversations', [{}, {}])[1].get('value', '')
                        
                        # 检查记录是否存在
                        check_existing = text("SELECT COUNT(*) FROM test.optimize_data WHERE question_no = :question_no")
                        existing_count = session.execute(check_existing, {'question_no': question_no}).scalar()
                        
                        if existing_count > 0:
                            # 更新现有记录
                            update_sql = text("""
                                UPDATE test.optimize_data 
                                SET text_optimized_question = :text_optimized_question,
                                    text_optimized_answer = :text_optimized_answer
                                WHERE question_no = :question_no
                            """)
                            session.execute(update_sql, {
                                'question_no': question_no,
                                'text_optimized_question': optimized_question,
                                'text_optimized_answer': optimized_answer
                            })
                        else:
                            # 插入新记录
                            insert_sql = text("""
                                INSERT INTO test.optimize_data (question_no, text_optimized_question, text_optimized_answer)
                                VALUES (:question_no, :text_optimized_question, :text_optimized_answer)
                            """)
                            session.execute(insert_sql, {
                                'question_no': question_no,
                                'text_optimized_question': optimized_question,
                                'text_optimized_answer': optimized_answer
                            })
                
                # 存储多模态优化结果
                for item in vl_optimized_data:
                    question_no = item.get('id')
                    if question_no:
                        optimized_question = item.get('conversations', [{}])[0].get('value', '')
                        optimized_answer = item.get('conversations', [{}, {}])[1].get('value', '')
                        
                        # 检查记录是否存在
                        check_existing = text("SELECT COUNT(*) FROM test.optimize_data WHERE question_no = :question_no")
                        existing_count = session.execute(check_existing, {'question_no': question_no}).scalar()
                        
                        if existing_count > 0:
                            # 更新现有记录
                            update_sql = text("""
                                UPDATE test.optimize_data 
                                SET optimized_question = :optimized_question,
                                    optimized_answer = :optimized_answer
                                WHERE question_no = :question_no
                            """)
                            session.execute(update_sql, {
                                'question_no': question_no,
                                'optimized_question': optimized_question,
                                'optimized_answer': optimized_answer
                            })
                        else:
                            # 插入新记录
                            insert_sql = text("""
                                INSERT INTO test.optimize_data (question_no, optimized_question, optimized_answer)
                                VALUES (:question_no, :optimized_question, :optimized_answer)
                            """)
                            session.execute(insert_sql, {
                                'question_no': question_no,
                                'optimized_question': optimized_question,
                                'optimized_answer': optimized_answer
                            })
                
                session.commit()
                session.close()
            except Exception as e:
                logging.error(f"存储优化结果到数据库失败: {e}")
        else:
            logging.info("测试模式: 不存储优化结果到数据库")
        
        return jsonify({
            'success': True,
            'message': f'优化完成，共处理 {total_optimized} 条数据（纯文本: {len(text_optimized_data)} 条，多模态: {len(vl_optimized_data)} 条）',
            'data': {
                'optimized_count': total_optimized,
                'text_optimized_count': len(text_optimized_data),
                'vl_optimized_count': len(vl_optimized_data),
                'text_model': text_model,
                'vl_model': vl_model
            }
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def optimize_with_text_model(input_path, model_name, api_key, api_base_url, question_prompt, answer_prompt, test_mode=False, test_count=10, batch_size=1000):
    """
    使用文本模型优化数据
    """
    import time
    import concurrent.futures
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import logging
    
    # 配置日志
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    
    # 读取数据
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 在测试模式下只处理前 test_count 条数据
    if test_mode:
        data = data[:test_count]
        logging.info(f"测试模式: 只处理前 {test_count} 条数据")
    
    # 使用自定义提示词或默认提示词
    question_prompt = question_prompt if question_prompt else DEFAULT_PROMPTS['text']['question']
    answer_prompt = answer_prompt if answer_prompt else DEFAULT_PROMPTS['text']['answer']
    
    # API调用函数
    def call_api(messages, max_tokens=2000):
        """
        调用API
        """
        import requests
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model_name,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "top_p": 0.9,
            "stream": False
        }
        
        max_retries = 5
        for attempt in range(max_retries):
            try:
                response = requests.post(
                    f"{api_base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=60
                )
                
                if response.status_code == 200:
                    result = response.json()
                    return result["choices"][0]["message"]["content"]
                else:
                    error_data = response.json() if response.text else {}
                    error_message = error_data.get("error", {}).get("message", "") if error_data else response.text
                    logging.warning(f"API 调用失败 (尝试 {attempt+1}/{max_retries}): {response.status_code} - {error_message}")
                    
                    if attempt < max_retries - 1:
                        wait_time = min(2 ** attempt, 60)
                        time.sleep(wait_time)
            except requests.exceptions.RequestException as e:
                logging.warning(f"网络错误 (尝试 {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    wait_time = min(2 ** attempt, 60)
                    time.sleep(wait_time)
        
        raise Exception(f"API 调用失败，已达最大重试次数 {max_retries}")
    
    # 处理单个项目
    def process_item(item):
        """
        处理单个数据项
        """
        item_id = item.get("id", "unknown")
        original_question = item["conversations"][0]["value"]
        original_answer = item["conversations"][1]["value"]
        image = item.get("image", [])
        
        logging.info(f"开始处理项目 {item_id}")
        
        start_time = time.time()
        
        try:
            # 优化问题
            messages = [
                {
                    "role": "system",
                    "content": question_prompt
                },
                {
                    "role": "user",
                    "content": f"原始问题：{original_question}\n\n请优化此问题。"
                }
            ]
            optimized_question = call_api(messages, max_tokens=500)
            optimized_question = optimized_question.strip()
            
            # 优化答案
            messages = [
                {
                    "role": "system",
                    "content": answer_prompt
                },
                {
                    "role": "user",
                    "content": f"优化后的问题：{optimized_question}\n\n原始回答：{original_answer}\n\n请优化此回答。"
                }
            ]
            optimized_answer = call_api(messages, max_tokens=1500)
            optimized_answer = optimized_answer.strip()
            
            processing_time = time.time() - start_time
            
            result = {
                "id": item_id,
                "image": image,
                "original_question": original_question,
                "original_answer": original_answer,
                "optimized_question": optimized_question,
                "optimized_answer": optimized_answer,
                "processing_time": round(processing_time, 2),
                "status": "success"
            }
            
            logging.info(f"处理成功: {item_id} (耗时: {processing_time:.2f}s)")
            
        except Exception as e:
            processing_time = time.time() - start_time
            result = {
                "id": item_id,
                "image": image,
                "original_question": original_question,
                "original_answer": original_answer,
                "optimized_question": original_question,
                "optimized_answer": original_answer,
                "processing_time": round(processing_time, 2),
                "status": "failed",
                "error": str(e)
            }
            
            logging.error(f"处理失败: {item_id} - {e}")
        
        return result
    
    # 批量并行处理数据
    results = []
    max_workers = 3
    total_items = len(data)
    
    # 按批次处理
    for i in range(0, total_items, batch_size):
        batch_data = data[i:i+batch_size]
        batch_size_actual = len(batch_data)
        logging.info(f"开始处理批次 {i//batch_size + 1}/{(total_items + batch_size - 1)//batch_size}，共 {batch_size_actual} 条数据")
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_item = {executor.submit(process_item, item): item for item in batch_data}
            
            for future in as_completed(future_to_item):
                try:
                    result = future.result(timeout=300)
                    results.append(result)
                except Exception as e:
                    item = future_to_item[future]
                    item_id = item.get("id", "unknown")
                    logging.error(f"处理项目 {item_id} 时出错: {e}")
                    results.append({
                        "id": item_id,
                        "original_question": item["conversations"][0]["value"],
                        "original_answer": item["conversations"][1]["value"],
                        "optimized_question": item["conversations"][0]["value"],
                        "optimized_answer": item["conversations"][1]["value"],
                        "status": "failed",
                        "error": str(e)
                    })
        
        logging.info(f"批次 {i//batch_size + 1} 处理完成，累计处理 {len(results)}/{total_items} 条数据")
    
    # 转换为训练格式
    optimized_data = []
    for result in results:
        optimized_item = {
            "id": result["id"],
            "image": result.get("image", []),
            "conversations": [
                {"from": "human", "value": result["optimized_question"]},
                {"from": "gpt", "value": result["optimized_answer"]}
            ],
            "metadata": {
                "original_question": result["original_question"],
                "original_answer": result["original_answer"],
                "processing_time": result["processing_time"],
                "status": result["status"]
            }
        }
        if "error" in result:
            optimized_item["metadata"]["error"] = result["error"]
        optimized_data.append(optimized_item)
    
    return optimized_data

def optimize_with_vl_model(input_path, model_name, api_key, api_base_url, question_prompt, answer_prompt, test_mode=False, test_count=10, batch_size=1000):
    """
    使用多模态模型优化数据
    """
    import time
    import concurrent.futures
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import logging
    
    # 配置日志
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    
    # 读取数据
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 在测试模式下只处理前 test_count 条数据
    if test_mode:
        data = data[:test_count]
        logging.info(f"测试模式: 只处理前 {test_count} 条数据")
    
    # 使用自定义提示词或默认提示词
    question_prompt = question_prompt if question_prompt else DEFAULT_PROMPTS['vl']['question']
    answer_prompt = answer_prompt if answer_prompt else DEFAULT_PROMPTS['vl']['answer']
    
    # API调用函数
    def call_api(messages, max_tokens=2000):
        """
        调用API
        """
        import requests
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model_name,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "top_p": 0.9,
            "stream": False
        }
        
        max_retries = 5
        for attempt in range(max_retries):
            try:
                response = requests.post(
                    f"{api_base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=60
                )
                
                if response.status_code == 200:
                    result = response.json()
                    return result["choices"][0]["message"]["content"]
                else:
                    error_data = response.json() if response.text else {}
                    error_message = error_data.get("error", {}).get("message", "") if error_data else response.text
                    logging.warning(f"API 调用失败 (尝试 {attempt+1}/{max_retries}): {response.status_code} - {error_message}")
                    
                    if attempt < max_retries - 1:
                        wait_time = min(2 ** attempt, 60)
                        time.sleep(wait_time)
            except requests.exceptions.RequestException as e:
                logging.warning(f"网络错误 (尝试 {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    wait_time = min(2 ** attempt, 60)
                    time.sleep(wait_time)
        
        raise Exception(f"API 调用失败，已达最大重试次数 {max_retries}")
    
    # 处理单个项目
    def process_item(item):
        """
        处理单个数据项
        """
        item_id = item.get("id", "unknown")
        original_question = item["conversations"][0]["value"]
        original_answer = item["conversations"][1]["value"]
        image = item.get("image", [])
        
        logging.info(f"开始处理项目 {item_id}")
        
        start_time = time.time()
        
        try:
            # 获取图片预签名URL
            def get_presigned_urls(image_urls):
                """
                获取图片的预签名URL
                """
                from models.models import create_engine_and_session, Image
                from minio import Minio
                from minio.error import S3Error
                from datetime import timedelta
                import os
                import sys
                
                # 添加当前目录到Python路径
                sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                from config.database import MINIO_CONFIG
                
                presigned_urls = []
                
                try:
                    # 初始化MinIO客户端
                    minio_client = Minio(
                        MINIO_CONFIG['endpoint'],
                        access_key=MINIO_CONFIG['access_key'],
                        secret_key=MINIO_CONFIG['secret_key'],
                        secure=MINIO_CONFIG['secure']
                    )
                    
                    # 构建图片URL列表
                    urls_to_process = []
                    if isinstance(image_urls, list):
                        urls_to_process = image_urls
                    elif isinstance(image_urls, str):
                        urls_to_process = [image_urls]
                    
                    for url in urls_to_process:
                        try:
                            object_name = url
                            
                            # 处理URL，考虑remote_path配置
                            if url.startswith('http://') or url.startswith('https://'):
                                # 如果是完整URL，提取对象路径
                                path = url.split('://')[-1].split('/')
                                # 跳过域名和browser部分，获取bucket和对象路径
                                if len(path) > 3:
                                    # 格式：http://minio-endpoint/browser/bucket/object-path
                                    object_name = '/'.join(path[3:])
                                elif len(path) == 3:
                                    # 格式：http://minio-endpoint/browser/bucket
                                    object_name = ''
                                elif len(path) == 2:
                                    # 格式：http://minio-endpoint/browser
                                    object_name = ''
                            else:
                                # 如果是相对路径，添加remote_path前缀
                                remote_path = MINIO_CONFIG.get('remote_path', '')
                                object_name = f"{remote_path.rstrip('/')}/{url.lstrip('/')}"
                            
                            # 生成7天过期的预签名URL
                            presigned_url = minio_client.presigned_get_object(
                                MINIO_CONFIG['bucket_name'],
                                object_name,
                                expires=timedelta(seconds=604800)  # 7天，单位秒
                            )
                            presigned_urls.append(presigned_url)
                        except S3Error as e:
                            logging.error(f"生成预签名URL失败: {e}")
                            # 失败时使用原始URL作为备选
                            presigned_urls.append(url)
                        except Exception as e:
                            logging.error(f"处理图片URL时出错: {e}")
                            # 失败时使用原始URL作为备选
                            presigned_urls.append(url)
                except Exception as e:
                    logging.error(f"获取预签名URL失败: {e}")
                    # 失败时使用原始URL列表
                    if isinstance(image_urls, list):
                        presigned_urls = image_urls
                    elif isinstance(image_urls, str):
                        presigned_urls = [image_urls]
                
                return presigned_urls
            
            # 构建用户内容，包含文本和图片
            user_content = [
                {"type": "text", "text": f"原始问题：{original_question}\n\n请根据图片内容优化此问题。"}
            ]
            
            # 添加图片数据
            image_count = 0
            if image:
                # 获取预签名URL
                presigned_urls = get_presigned_urls(image)
                
                if presigned_urls:
                    for img_url in presigned_urls:
                        if img_url:
                            user_content.append({
                                "type": "image_url",
                                "image_url": img_url
                            })
                            image_count += 1
            
            if image_count > 0:
                logging.info(f"成功添加 {image_count} 张图片到优化请求中")
            else:
                logging.info("未添加图片，将仅使用文本进行优化")
            
            # 优化问题
            messages = [
                {
                    "role": "system",
                    "content": question_prompt
                },
                {
                    "role": "user",
                    "content": user_content
                }
            ]
            optimized_question = call_api(messages, max_tokens=500)
            optimized_question = optimized_question.strip()
            
            # 构建用户内容，包含文本和图片
            user_content = [
                {"type": "text", "text": f"优化后的问题：{optimized_question}\n\n原始回答：{original_answer}\n\n请基于图片内容和专业知识优化此回答。"}
            ]
            
            # 添加图片数据
            image_count = 0
            if image:
                # 获取预签名URL
                presigned_urls = get_presigned_urls(image)
                
                if presigned_urls:
                    for img_url in presigned_urls:
                        if img_url:
                            user_content.append({
                                "type": "image_url",
                                "image_url": img_url
                            })
                            image_count += 1
            
            if image_count > 0:
                logging.info(f"成功添加 {image_count} 张图片到优化请求中")
            else:
                logging.info("未添加图片，将仅使用文本进行优化")
            
            # 优化答案
            messages = [
                {
                    "role": "system",
                    "content": answer_prompt
                },
                {
                    "role": "user",
                    "content": user_content
                }
            ]
            optimized_answer = call_api(messages, max_tokens=1500)
            optimized_answer = optimized_answer.strip()
            
            processing_time = time.time() - start_time
            
            result = {
                "id": item_id,
                "image": image,
                "original_question": original_question,
                "original_answer": original_answer,
                "optimized_question": optimized_question,
                "optimized_answer": optimized_answer,
                "processing_time": round(processing_time, 2),
                "status": "success"
            }
            
            logging.info(f"处理成功: {item_id} (耗时: {processing_time:.2f}s)")
            
        except Exception as e:
            processing_time = time.time() - start_time
            result = {
                "id": item_id,
                "image": image,
                "original_question": original_question,
                "original_answer": original_answer,
                "optimized_question": original_question,
                "optimized_answer": original_answer,
                "processing_time": round(processing_time, 2),
                "status": "failed",
                "error": str(e)
            }
            
            logging.error(f"处理失败: {item_id} - {e}")
        
        return result
    
    # 批量并行处理数据
    results = []
    max_workers = 3
    total_items = len(data)
    
    # 按批次处理
    for i in range(0, total_items, batch_size):
        batch_data = data[i:i+batch_size]
        batch_size_actual = len(batch_data)
        logging.info(f"开始处理批次 {i//batch_size + 1}/{(total_items + batch_size - 1)//batch_size}，共 {batch_size_actual} 条数据")
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_item = {executor.submit(process_item, item): item for item in batch_data}
            
            for future in as_completed(future_to_item):
                try:
                    result = future.result(timeout=300)
                    results.append(result)
                except Exception as e:
                    item = future_to_item[future]
                    item_id = item.get("id", "unknown")
                    logging.error(f"处理项目 {item_id} 时出错: {e}")
                    results.append({
                        "id": item_id,
                        "image_path": item.get("image", ""),
                        "original_question": item["conversations"][0]["value"],
                        "original_answer": item["conversations"][1]["value"],
                        "optimized_question": item["conversations"][0]["value"],
                        "optimized_answer": item["conversations"][1]["value"],
                        "status": "failed",
                        "error": str(e)
                    })
        
        logging.info(f"批次 {i//batch_size + 1} 处理完成，累计处理 {len(results)}/{total_items} 条数据")
    
    # 转换为训练格式
    optimized_data = []
    for result in results:
        optimized_item = {
            "id": result["id"],
            "image": result.get("image", []),
            "conversations": [
                {"from": "human", "value": result["optimized_question"]},
                {"from": "gpt", "value": result["optimized_answer"]}
            ],
            "metadata": {
                "original_question": result["original_question"],
                "original_answer": result["original_answer"],
                "processing_time": result["processing_time"],
                "status": result["status"]
            }
        }
        if "error" in result:
            optimized_item["metadata"]["error"] = result["error"]
        optimized_data.append(optimized_item)
    
    return optimized_data