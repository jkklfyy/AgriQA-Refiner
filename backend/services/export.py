"""
导出服务模块
将评分后的数据导出为符合 Qwen 大模型训练格式的 JSON 文件
"""

import json
import os
from datetime import datetime
from urllib.parse import urlparse
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.database import OUTPUT_FOLDER

def extract_filename_from_url(url):
    """
    从 URL 中提取文件名
    
    参数:
        url: 图片 URL
    
    返回:
        str: 文件名，如果 URL 为空或无效则返回 None
    """
    # 处理空值、NaN、None 等情况
    if not url:
        return None
    
    # 转换为字符串并检查
    url_str = str(url).strip()
    if not url_str or url_str.lower() == 'nan' or url_str.lower() == 'none':
        return None
    
    # 解析 URL 路径
    parsed = urlparse(url_str)
    path = parsed.path
    
    # 提取文件名
    filename = os.path.basename(path)
    
    return filename if filename else None

def prepare_training_data(questions_list, replies_list, images_list, session=None):
    """
    准备大模型训练数据
    
    参数:
        questions_list: 问题列表
        replies_list: 回复列表
        images_list: 图片列表
        session: 数据库会话对象（可选）
    
    返回:
        list: 符合 Qwen 训练格式的数据列表
    """
    import logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)
    
    logger.info(f"开始准备训练数据，问题数: {len(questions_list)}, 回复数: {len(replies_list)}, 图片数: {len(images_list)}")
    
    from collections import defaultdict
    from services.scoring import score_all_replies, get_best_reply_for_question
    
    # 1. 检查回复是否已评分，如果没有则进行评分
    replies_need_scoring = [reply for reply in replies_list if 'score' not in reply or reply['score'] is None]
    if replies_need_scoring:
        logger.info(f"发现 {len(replies_need_scoring)} 条回复需要评分")
        # 批量评分所有回复
        scored_replies = score_all_replies(replies_list, session)
        logger.info(f"评分完成，共处理 {len(scored_replies)} 条回复")
    else:
        logger.info("所有回复已包含评分，跳过评分步骤")
        scored_replies = replies_list
    
    # 构建问题映射
    questions_map = {q['question_no']: q for q in questions_list}
    logger.info(f"构建问题映射完成，共 {len(questions_map)} 个问题")
    
    # 构建图片映射（一个 question_no 对应多张图片）
    images_map = defaultdict(list)
    for img in images_list:
        entity_id = img.get('entity_id')
        url = img.get('url')
        # 过滤空值：entity_id 和 url 都必须存在且不为空
        if entity_id and url and str(url).strip() and str(url).lower() != 'nan':
            filename = extract_filename_from_url(url)
            if filename:
                images_map[entity_id].append(filename)
                logger.info(f"添加图片到问题 {entity_id}: {filename}")
    
    logger.info(f"构建图片映射完成，共 {len(images_map)} 个问题有图片")
    
    # 展示有多个图片的分组
    multi_image_groups = 0
    for entity_id, images in images_map.items():
        if len(images) > 2:
            multi_image_groups += 1
            if multi_image_groups <= 3:  # 只展示前3个示例
                logger.info(f"图片分组示例 - 问题 {entity_id}: {len(images)} 张图片 - {images}")
    logger.info(f"共有 {multi_image_groups} 个问题包含超过2张图片")
    
    # 2. 为每个问题选择最佳回复
    best_replies = get_best_reply_for_question(scored_replies, session)
    logger.info(f"选择最佳回复完成，共 {len(best_replies)} 个问题有最佳回复")
    
    # 构建训练数据
    training_data = []
    
    for question_no, question in questions_map.items():
        # 获取最佳回复
        best_reply = best_replies.get(question_no)
        if not best_reply:
            logger.info(f"问题 {question_no} 没有最佳回复，跳过")
            continue
        
        # 获取图片列表
        image_list = images_map.get(question_no, [])
        
        # 构建训练样本
        sample = {
            'id': question_no,
            'image': image_list,
            'conversations': [
                {
                    'from': 'human',
                    'value': build_human_value(question, image_list)
                },
                {
                    'from': 'gpt',
                    'value': best_reply.get('content', '')
                }
            ]
        }
        
        training_data.append(sample)
    
    logger.info(f"训练数据准备完成，共 {len(training_data)} 条")
    
    return training_data

def build_human_value(question, image_list):
    """
    构建人类提问的 value 字段
    
    参数:
        question: 问题数据
        image_list: 图片文件名列表
    
    返回:
        str: 格式化的提问内容
    """
    # 添加图片标签
    image_tags = ' '.join(['<image>' for _ in image_list])
    
    # 构建完整的提问内容
    question_content = question.get('quiz_desc', '') or question.get('content', '')
    if image_tags:
        human_value = f"{image_tags} {question_content}"
    else:
        human_value = question_content
    
    return human_value

def export_to_json(training_data, output_filename=None):
    """
    导出为 JSON 文件
    
    参数:
        training_data: 训练数据列表
        output_filename: 输出文件名（可选）
    
    返回:
        str: 输出文件的完整路径
    """
    # 确保输出目录存在
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)
    
    # 生成文件名
    if not output_filename:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_filename = f'training_data_{timestamp}.json'
    
    output_path = os.path.join(OUTPUT_FOLDER, output_filename)
    
    # 写入文件
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(training_data, f, ensure_ascii=False, indent=2)
    
    return output_path

def save_training_data(training_data, output_filename=None):
    """
    保存训练数据到 JSON 文件
    
    参数:
        training_data: 训练数据列表
        output_filename: 输出文件名（可选）
    
    返回:
        str: 输出文件的完整路径
    """
    return export_to_json(training_data, output_filename)

def export_from_database(session, output_filename=None):
    """
    从数据库导出训练数据
    
    参数:
        session: 数据库会话
        output_filename: 输出文件名
    
    返回:
        str: 输出文件路径
    """
    from models.models import Question, Reply, Image
    
    # 查询所有数据（不再过滤 evl，因为数据库表可能没有这个列）
    questions = session.query(Question).all()
    replies = session.query(Reply).all()  # 获取所有回复
    images = session.query(Image).all()
    
    # 转换为字典格式
    questions_list = [q.to_dict() for q in questions]
    replies_list = [r.to_dict() for r in replies]
    images_list = [i.to_dict() for i in images]
    
    # 准备训练数据
    training_data = prepare_training_data(questions_list, replies_list, images_list, session)
    
    # 导出到文件
    output_path = export_to_json(training_data, output_filename)
    
    return output_path, len(training_data)
