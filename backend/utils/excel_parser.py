"""
Excel 解析工具模块
解析用户上传的 Excel 文件
"""

import pandas as pd
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.database import EXCEL_COLUMN_MAPPING, UPLOAD_FOLDER

def parse_single_excel_file(file_path, filename):
    """
    解析单个 Excel 文件，自动识别表的类型
    
    参数:
        file_path: Excel 文件路径
        filename: 文件名（用于判断表类型）
    
    返回:
        tuple: (表类型，数据列表)
    """
    try:
        excel_file = pd.ExcelFile(file_path)
        sheet_names = excel_file.sheet_names
        
        # 根据文件名判断表类型
        filename_lower = filename.lower()
        
        # 判断是否为问题表
        if any(keyword in filename_lower for keyword in ['question', '问题', 'questions']):
            # 读取第一个 sheet
            df = pd.read_excel(file_path, sheet_name=sheet_names[0])
            data = df.to_dict('records')
            return 'questions', data
        
        # 判断是否为回复表
        elif any(keyword in filename_lower for keyword in ['reply', '回复', 'replies']):
            df = pd.read_excel(file_path, sheet_name=sheet_names[0])
            data = df.to_dict('records')
            return 'replies', data
        
        # 判断是否为图片表
        elif any(keyword in filename_lower for keyword in ['image', '图片', 'images']):
            df = pd.read_excel(file_path, sheet_name=sheet_names[0])
            data = df.to_dict('records')
            return 'images', data
        
        # 如果文件名无法判断，尝试根据 sheet 名判断
        else:
            if 'questions' in sheet_names or '问题表' in sheet_names:
                sheet_name = 'questions' if 'questions' in sheet_names else '问题表'
                df = pd.read_excel(file_path, sheet_name=sheet_name)
                return 'questions', df.to_dict('records')
            elif 'replies' in sheet_names or '回复表' in sheet_names:
                sheet_name = 'replies' if 'replies' in sheet_names else '回复表'
                df = pd.read_excel(file_path, sheet_name=sheet_name)
                return 'replies', df.to_dict('records')
            elif 'images' in sheet_names or '图片表' in sheet_names:
                sheet_name = 'images' if 'images' in sheet_names else '图片表'
                df = pd.read_excel(file_path, sheet_name=sheet_name)
                return 'images', df.to_dict('records')
        
        # 如果都无法判断，默认作为问题表
        df = pd.read_excel(file_path, sheet_name=sheet_names[0])
        return 'questions', df.to_dict('records')
    
    except Exception as e:
        raise Exception(f"解析 Excel 文件失败：{str(e)}")

def parse_excel_file(file_path):
    """
    解析 Excel 文件，提取三个表的数据（兼容旧方法）
    
    参数:
        file_path: Excel 文件路径
    
    返回:
        dict: 包含 questions, replies, images 三个列表的字典
    """
    # 读取 Excel 文件
    try:
        # 尝试读取所有 sheet
        excel_file = pd.ExcelFile(file_path)
        sheet_names = excel_file.sheet_names
        
        result = {
            'questions': [],
            'replies': [],
            'images': []
        }
        
        # 读取问题表
        if 'questions' in sheet_names or '问题表' in sheet_names:
            sheet_name = 'questions' if 'questions' in sheet_names else '问题表'
            df_questions = pd.read_excel(file_path, sheet_name=sheet_name)
            result['questions'] = df_questions.to_dict('records')
        
        # 读取回复表
        if 'replies' in sheet_names or '回复表' in sheet_names:
            sheet_name = 'replies' if 'replies' in sheet_names else '回复表'
            df_replies = pd.read_excel(file_path, sheet_name=sheet_name)
            result['replies'] = df_replies.to_dict('records')
        
        # 读取图片表
        if 'images' in sheet_names or '图片表' in sheet_names:
            sheet_name = 'images' if 'images' in sheet_names else '图片表'
            df_images = pd.read_excel(file_path, sheet_name=sheet_name)
            result['images'] = df_images.to_dict('records')
        
        return result
    
    except Exception as e:
        raise Exception(f"解析 Excel 文件失败：{str(e)}")

def save_uploaded_file(file_content, filename):
    """
    保存上传的文件
    
    参数:
        file_content: 文件内容
        filename: 文件名
    
    返回:
        str: 保存后的文件路径
    """
    # 确保上传目录存在
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    
    # 生成唯一文件名
    import uuid
    unique_filename = f"{uuid.uuid4()}_{filename}"
    file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
    
    # 保存文件
    with open(file_path, 'wb') as f:
        f.write(file_content)
    
    return file_path

def validate_excel_data(data, allow_partial=False):
    """
    验证 Excel 数据的完整性
    
    参数:
        data: 解析后的数据字典
        allow_partial: 是否允许部分数据（用于分步上传）
    
    返回:
        tuple: (是否有效，错误信息)
    """
    if not allow_partial:
        # 严格模式：需要所有数据
        if not data.get('questions'):
            return False, "缺少问题表数据"
        
        if not data.get('replies'):
            return False, "缺少回复表数据"
    
    # 检查问题表字段
    if data.get('questions'):
        first_question = data['questions'][0]
        if 'question_no' not in first_question:
            return False, "问题表缺少 question_no 字段"
        # 检查 quiz_desc 或 content 字段
        if 'quiz_desc' not in first_question and 'content' not in first_question:
            return False, "问题表缺少 quiz_desc 或 content 字段"
    
    # 检查回复表字段
    if data.get('replies'):
        first_reply = data['replies'][0]
        required_fields = ['question_no', 'content']
        for field in required_fields:
            if field not in first_reply:
                return False, f"回复表缺少 {field} 字段"
    
    return True, ""
