import json
import os
import re
import logging
import traceback
from typing import List, Dict, Any

# 确保输出目录存在
from config.database import OUTPUT_FOLDER

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 设置环境变量，强制离线模式
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_DATASETS_OFFLINE'] = '1'
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING'] = '1'

# 设置超时
import socket
socket.setdefaulttimeout(300)  # 5分钟超时

class SimplifiedDiagnosisAnalyzer:
    """简化版诊断分析器"""
    
    def __init__(self, model_name='paraphrase-multilingual-MiniLM-L12-v2'):
        self.model = None
        self.util = None
        try:
            from sentence_transformers import SentenceTransformer, util
            
            # 尝试从本地加载模型
            local_model_path = os.path.join(os.path.dirname(__file__), '..', 'models', model_name)
            
            if os.path.exists(local_model_path):
                logger.info(f"从本地加载模型: {local_model_path}")
                self.model = SentenceTransformer(local_model_path)
            else:
                logger.info(f"从网络加载模型: {model_name}")
                self.model = SentenceTransformer(model_name)
            
            self.util = util
            logger.info(f"成功加载模型: {model_name}")
        except ImportError as e:
            logger.error(f"导入sentence_transformers库失败: {e}")
        except Exception as e:
            logger.error(f"加载模型失败: {e}")
    
    def extract_diagnosis_text(self, answer_text: str) -> str:
        """
        提取诊断结论部分
        从冒号(:或：)开始，到句号(。)结束
        """
        if not answer_text or not isinstance(answer_text, str):
            return ""
        
        # 清理文本
        text = answer_text.strip()
        
        # 定义提取模式
        patterns = [
            # 模式1: 诊断结论: ...。  (最常用格式)
            r"诊断结论[:：]\s*([^。]*?[。])",
            # 模式2: 诊断: ...。  (简洁格式)
            r"诊断[:：]\s*([^。]*?[。])",
            # 模式3: 结论: ...。  (简化格式)
            r"结论[:：]\s*([^。]*?[。])",
            # 模式4: 结合图片诊断为: ...。 (结合图片的描述)
            r"结合.*?诊断为[:：]\s*([^。]*?[。])",
            # 模式5: 该症状为: ...。 (症状描述)
            r"该症状(?:为|是)[:：]?\s*([^。]*?[。])",
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.DOTALL)
            if match:
                diagnosis_text = match.group(1).strip()
                # 确保以句号结束
                if not diagnosis_text.endswith("。"):
                    diagnosis_text += "。"
                return diagnosis_text
        
        # 如果没有找到标准格式，尝试找到包含"病"或"症"的第一句话
        sentences = re.split(r'[。！？!?]', text)
        for sentence in sentences:
            if "病" in sentence or "症" in sentence or "诊断" in sentence:
                # 提取从冒号到结尾的部分
                colon_match = re.search(r'[:：]\s*(.*)', sentence)
                if colon_match:
                    diagnosis_text = colon_match.group(1).strip()
                    if diagnosis_text:
                        return diagnosis_text + "。"
                else:
                    # 如果没有冒号，返回整个句子
                    if len(sentence.strip()) > 5:  # 避免太短的句子
                        return sentence.strip() + "。"
        
        return ""
    
    def calculate_semantic_similarity(self, text1: str, text2: str) -> float:
        """计算两段文本的语义相似度"""
        if not text1 or not text2:
            return 0.0
        
        if not self.model or not self.util:
            logger.warning("模型未加载，使用简单字符串相似度")
            # 使用简单的字符串相似度作为备选
            return self._simple_string_similarity(text1, text2)
        
        try:
            embeddings1 = self.model.encode(text1, convert_to_tensor=True)
            embeddings2 = self.model.encode(text2, convert_to_tensor=True)
            
            similarity = self.util.cos_sim(embeddings1, embeddings2)
            return similarity.item()
        except Exception as e:
            logger.error(f"语义相似度计算出错: {e}")
            # 出错时使用简单字符串相似度
            return self._simple_string_similarity(text1, text2)
    
    def _simple_string_similarity(self, text1: str, text2: str) -> float:
        """简单的字符串相似度计算"""
        try:
            # 计算共同词的比例
            words1 = set(text1.split())
            words2 = set(text2.split())
            common_words = words1.intersection(words2)
            if not words1 and not words2:
                return 1.0
            return len(common_words) / max(len(words1), len(words2))
        except Exception as e:
            logger.error(f"简单字符串相似度计算出错: {e}")
            return 0.0
    
    def analyze_qa_pair(self, qa1: Dict, qa2: Dict) -> Dict[str, Any]:
        """分析问答对"""
        # 提取问题和答案
        q1 = qa1.get("question", "")
        a1 = qa1.get("answer", "")
        q2 = qa2.get("question", "")
        a2 = qa2.get("answer", "")
        
        # 提取诊断结论
        diagnosis1 = self.extract_diagnosis_text(a1)
        diagnosis2 = self.extract_diagnosis_text(a2)
        
        # 计算诊断相似度
        diagnosis_similarity = 0.0
        if diagnosis1 and diagnosis2:
            diagnosis_similarity = self.calculate_semantic_similarity(diagnosis1, diagnosis2)
        
        # 计算问题和答案的语义相似度
        question_similarity = self.calculate_semantic_similarity(q1, q2)
        answer_similarity = self.calculate_semantic_similarity(a1, a2)
        qa_similarity = (question_similarity + answer_similarity) / 2
        
        return {
            "diagnosis_text1": diagnosis1,
            "diagnosis_text2": diagnosis2,
            "diagnosis_similarity": round(diagnosis_similarity, 4),
            "question_similarity": round(question_similarity, 4),
            "answer_similarity": round(answer_similarity, 4),
            "qa_similarity": round(qa_similarity, 4),
            "has_diagnosis1": bool(diagnosis1),
            "has_diagnosis2": bool(diagnosis2)
        }

def load_json_data(file_path: str) -> List[Dict]:
    """加载JSON文档数据"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data
    except Exception as e:
        print(f"加载JSON文件出错: {e}")
        return []

def get_entry_identifier(entry: Dict, entry_index: int = None) -> str:
    """从条目中提取标识符"""
    id_fields = ["id", "编号", "ID", "index", "序号", "question_id", "entry_id", "uuid"]
    
    for field in id_fields:
        if field in entry:
            value = entry[field]
            if value is not None:
                return f"id:{value}"
    
    if entry_index is not None:
        return f"index:{entry_index}"
    
    return "index:unknown"

def extract_qa_from_entry(entry: Dict) -> Dict[str, str]:
    """
    从条目中提取问题和答案
    支持两种格式：
    1. 旧格式：包含 optimized_question 和 optimized_answer 字段
    2. 新格式：包含 conversations 数组，其中 from: "human" 是问题，from: "gpt" 是答案
    """
    result = {"question": "", "answer": ""}
    
    # 检查是否是新的conversations格式
    if "conversations" in entry and isinstance(entry["conversations"], list):
        conversations = entry["conversations"]
        
        # 查找human的问题
        for conv in conversations:
            if isinstance(conv, dict) and conv.get("from") == "human":
                result["question"] = str(conv.get("value", ""))
                break
        
        # 查找gpt的答案
        for conv in conversations:
            if isinstance(conv, dict) and conv.get("from") == "gpt":
                result["answer"] = str(conv.get("value", ""))
                break
    
    # 如果不是新格式，则使用旧格式
    if not result["question"] and "optimized_question" in entry:
        result["question"] = str(entry.get("optimized_question", ""))
    
    if not result["answer"] and "optimized_answer" in entry:
        result["answer"] = str(entry.get("optimized_answer", ""))
    
    # 如果都没有找到，尝试其他可能的字段
    if not result["question"] and "question" in entry:
        result["question"] = str(entry.get("question", ""))
    
    if not result["answer"] and "answer" in entry:
        result["answer"] = str(entry.get("answer", ""))
    
    return result

def analyze_diagnosis_similarity(
    doc1_path: str = None,
    doc2_path: str = None,
    output_base_path: str = "diagnosis_analysis",
    doc1_data: List[Dict] = None,
    doc2_data: List[Dict] = None
) -> Dict[str, Any]:
    """
    简化版诊断相似度分析
    
    参数:
        doc1_path: 文档1的路径（可选）
        doc2_path: 文档2的路径（可选）
        output_base_path: 输出基础路径
        doc1_data: 文档1的数据（可选，优先使用）
        doc2_data: 文档2的数据（可选，优先使用）
    """
    try:
        # 1. 加载数据
        if doc1_data and doc2_data:
            logger.info("使用直接提供的数据")
        elif doc1_path and doc2_path:
            logger.info(f"加载数据文件: doc1={doc1_path}, doc2={doc2_path}")
            doc1_data = load_json_data(doc1_path)
            doc2_data = load_json_data(doc2_path)
        else:
            logger.error("未提供数据或文件路径")
            return {
                "high_similarity_entries": [],
                "all_entries": [],
                "training_format_data": []
            }
        
        logger.info(f"数据加载完成，doc1条目数: {len(doc1_data)}, doc2条目数: {len(doc2_data)}")
        
        if not doc1_data or not doc2_data:
            logger.warning("数据为空，返回空结果")
            return {
                "high_similarity_entries": [],
                "all_entries": [],
                "training_format_data": []
            }
        
        # 2. 构建doc2的标识符到条目的映射
        logger.info("构建doc2的标识符到条目的映射")
        doc2_map = {}
        for idx, entry in enumerate(doc2_data):
            identifier = get_entry_identifier(entry, idx)
            doc2_map[identifier] = entry
        
        logger.info(f"映射构建完成，doc2映射条目数: {len(doc2_map)}")
        
        # 3. 初始化分析器
        logger.info("初始化诊断分析器")
        analyzer = SimplifiedDiagnosisAnalyzer()
        
        # 4. 分析所有匹配条目
        high_similarity_entries = []
        all_entries = []
        training_format_data = []
        
        logger.info("开始分析匹配条目")
        for idx, entry1 in enumerate(doc1_data):
            if idx % 10 == 0:
                logger.info(f"分析进度: {idx}/{len(doc1_data)}")
            
            identifier = get_entry_identifier(entry1, idx)
            
            # 检查doc2中是否有相同标识符的条目
            if identifier in doc2_map:
                entry2 = doc2_map[identifier]
                
                # 从条目中提取问答对
                qa1 = extract_qa_from_entry(entry1)
                qa2 = extract_qa_from_entry(entry2)
                
                # 检查是否有有效的问题和答案
                if not qa1["question"] or not qa1["answer"] or not qa2["question"] or not qa2["answer"]:
                    continue
                
                # 分析问答对
                analysis_result = analyzer.analyze_qa_pair(qa1, qa2)
                
                # 提取原始问答
                original_question1 = ""
                original_answer1 = ""
                
                # 从entry1中提取原始问答
                if "metadata" in entry1 and isinstance(entry1["metadata"], dict):
                    original_question1 = entry1["metadata"].get("original_question", "")
                    original_answer1 = entry1["metadata"].get("original_answer", "")
                
                # 构建结果条目
                result_entry = {
                    "id_value": identifier.replace("id:", ""),
                    "image": entry1.get("image", []),
                    "doc1_question": qa1["question"],
                    "doc1_answer": qa1["answer"],
                    "doc2_question": qa2["question"],
                    "doc2_answer": qa2["answer"],
                    "original_question1": original_question1,
                    "original_answer1": original_answer1,
                    "analysis": {
                        "diagnosis_text1": analysis_result["diagnosis_text1"],
                        "diagnosis_text2": analysis_result["diagnosis_text2"],
                        "diagnosis_similarity": analysis_result["diagnosis_similarity"],
                        "question_similarity": analysis_result["question_similarity"],
                        "answer_similarity": analysis_result["answer_similarity"],
                        "qa_similarity": analysis_result["qa_similarity"]
                    }
                }
                
                # 添加到全部条目
                all_entries.append(result_entry)
                
                # 检查是否是纯文本数据（没有图片）
                is_text_only = True
                image_count = 0
                if "image" in entry1 and isinstance(entry1["image"], list):
                    image_count = len(entry1["image"])
                    is_text_only = image_count == 0
                
                # 只保留高相似度条目和纯文本数据
                diagnosis_similarity = analysis_result["diagnosis_similarity"]
                has_diagnosis1 = analysis_result["has_diagnosis1"]
                has_diagnosis2 = analysis_result["has_diagnosis2"]
                qa_similarity = analysis_result["qa_similarity"]
                
                # 对于纯文本数据，直接视为高相似度
                if is_text_only or (has_diagnosis1 and has_diagnosis2 and (diagnosis_similarity >= 0.65 or qa_similarity >= 0.7)):
                    high_similarity_entries.append(result_entry)
                    # 处理训练格式数据
                    processed_entry = {
                        "id": entry1.get("id", identifier),
                        "image": entry1.get("image", []),
                        "conversations": []
                    }
                    
                    # 处理 conversations
                    if "conversations" in entry1 and isinstance(entry1["conversations"], list):
                        for conv in entry1["conversations"]:
                            if isinstance(conv, dict):
                                if conv.get("from") == "human":
                                    # 添加<image>标志
                                    image_tags = "<image>" * image_count
                                    human_value = f"{image_tags}{conv.get('value', '')}"
                                    processed_entry["conversations"].append({
                                        "from": "human",
                                        "value": human_value
                                    })
                                elif conv.get("from") == "gpt":
                                    processed_entry["conversations"].append({
                                        "from": "gpt",
                                        "value": conv.get("value", "")
                                    })
                    
                    # 只添加有完整对话的条目
                    if len(processed_entry["conversations"]) >= 2:
                        training_format_data.append(processed_entry)
        
        logger.info(f"分析完成，高相似度条目数: {len(high_similarity_entries)}, 总条目数: {len(all_entries)}, 训练格式数据数: {len(training_format_data)}")
        
        return {
            "high_similarity_entries": high_similarity_entries,
            "all_entries": all_entries,
            "training_format_data": training_format_data
        }
    except Exception as e:
        logger.error(f"分析诊断相似度时出错: {e}")
        logger.error(f"错误堆栈: {traceback.format_exc()}")
        return {
            "high_similarity_entries": [],
            "all_entries": [],
            "training_format_data": []
        }

def process_similarity_analysis(text_file_path: str, vl_file_path: str) -> Dict[str, Any]:
    """
    处理相似度分析
    """
    try:
        # 生成输出文件名
        timestamp = os.path.splitext(os.path.basename(text_file_path))[0].replace("optimized_text_", "")
        output_base = os.path.join(OUTPUT_FOLDER, f"similarity_analysis_{timestamp}")
        
        logger.info(f"开始相似度分析: text_file={text_file_path}, vl_file={vl_file_path}")
        logger.info(f"输出基础路径: {output_base}")
        
        # 检查文件是否存在
        if not os.path.exists(text_file_path):
            logger.error(f"文本优化文件不存在: {text_file_path}")
            return {
                "high_similarity_path": "",
                "all_entries_path": "",
                "training_format_path": "",
                "high_similarity_count": 0,
                "all_entries_count": 0,
                "training_format_count": 0
            }
        
        if not os.path.exists(vl_file_path):
            logger.error(f"多模态优化文件不存在: {vl_file_path}")
            return {
                "high_similarity_path": "",
                "all_entries_path": "",
                "training_format_path": "",
                "high_similarity_count": 0,
                "all_entries_count": 0,
                "training_format_count": 0
            }
        
        # 检查文件大小
        text_file_size = os.path.getsize(text_file_path)
        vl_file_size = os.path.getsize(vl_file_path)
        logger.info(f"文件大小: text_file={text_file_size} bytes, vl_file={vl_file_size} bytes")
        
        # 执行分析
        logger.info("开始执行诊断相似度分析...")
        analysis_result = analyze_diagnosis_similarity(
            doc1_path=vl_file_path,  # 多模态优化结果作为doc1
            doc2_path=text_file_path,  # 文本优化结果作为doc2
            output_base_path=output_base
        )
        
        logger.info(f"分析完成，高相似度条目数: {len(analysis_result['high_similarity_entries'])}, 总条目数: {len(analysis_result['all_entries'])}")
        
        # 保存高相似度条目
        high_similarity_path = f"{output_base}_high.json"
        logger.info(f"保存高相似度条目到: {high_similarity_path}")
        with open(high_similarity_path, 'w', encoding='utf-8') as f:
            json.dump(analysis_result["high_similarity_entries"], f, ensure_ascii=False, indent=2)
        
        # 保存全部条目
        all_entries_path = f"{output_base}_all.json"
        logger.info(f"保存全部条目到: {all_entries_path}")
        with open(all_entries_path, 'w', encoding='utf-8') as f:
            json.dump(analysis_result["all_entries"], f, ensure_ascii=False, indent=2)
        
        # 保存训练格式数据
        training_format_path = f"{output_base}_training.json"
        logger.info(f"保存训练格式数据到: {training_format_path}")
        with open(training_format_path, 'w', encoding='utf-8') as f:
            json.dump(analysis_result["training_format_data"], f, ensure_ascii=False, indent=2)
        
        logger.info(f"相似度分析完成，保存结果到: {high_similarity_path}, {all_entries_path} 和 {training_format_path}")
        
        return {
            "high_similarity_path": high_similarity_path,
            "all_entries_path": all_entries_path,
            "training_format_path": training_format_path,
            "high_similarity_count": len(analysis_result["high_similarity_entries"]),
            "all_entries_count": len(analysis_result["all_entries"]),
            "training_format_count": len(analysis_result["training_format_data"])
        }
    except Exception as e:
        logger.error(f"处理相似度分析时出错: {e}")
        logger.error(f"错误堆栈: {traceback.format_exc()}")
        # 即使出错也返回一个默认结果，避免前端崩溃
        return {
            "high_similarity_path": "",
            "all_entries_path": "",
            "training_format_path": "",
            "high_similarity_count": 0,
            "all_entries_count": 0,
            "training_format_count": 0
        }

def analyze_similarity_from_database(text_data: List[Dict], vl_data: List[Dict]) -> Dict[str, Any]:
    """
    直接从数据库数据进行相似度分析
    
    参数:
        text_data: 文本优化数据列表
        vl_data: 多模态优化数据列表
    
    返回:
        相似度分析结果
    """
    try:
        import tempfile
        
        # 创建临时文件存储数据
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as temp_file:
            json.dump(text_data, temp_file)
            text_file_path = temp_file.name
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as temp_file:
            json.dump(vl_data, temp_file)
            vl_file_path = temp_file.name
        
        # 执行相似度分析
        result = process_similarity_analysis(text_file_path, vl_file_path)
        
        # 删除临时文件
        import os
        os.unlink(text_file_path)
        os.unlink(vl_file_path)
        
        return result
    except Exception as e:
        logger.error(f"从数据库数据进行相似度分析时出错: {e}")
        logger.error(f"错误堆栈: {traceback.format_exc()}")
        return {
            "high_similarity_path": "",
            "all_entries_path": "",
            "training_format_path": "",
            "high_similarity_count": 0,
            "all_entries_count": 0,
            "training_format_count": 0
        }

def analyze_similarity_directly(optimize_data_list: List[Dict]) -> Dict[str, Any]:
    """
    直接对比数据库中的字段内容进行相似度分析
    
    参数:
        optimize_data_list: 包含 optimize_data 表数据的列表
    
    返回:
        相似度分析结果
    """
    try:
        import os
        from config.database import OUTPUT_FOLDER
        from models.models import create_engine_and_session
        
        # 生成输出文件名
        import time
        timestamp = str(int(time.time()))
        output_base = os.path.join(OUTPUT_FOLDER, f"similarity_analysis_{timestamp}")
        
        # 直接使用数据库字段进行分析，不构建中间数据结构
        logger.info("开始执行诊断相似度分析...")
        
        # 初始化分析器
        analyzer = SimplifiedDiagnosisAnalyzer()
        
        # 创建数据库会话
        engine, session = create_engine_and_session()
        
        all_entries = []
        training_format_data = []
        high_similarity_count = 0
        update_entries = []
        
        # 查询图片数据
        from collections import defaultdict
        question_images = defaultdict(list)
        try:
            # 检查 test.images 表是否存在
            from sqlalchemy import text
            check_image_table = text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'images' AND table_schema = 'test')")
            image_table_exists = session.execute(check_image_table).scalar()
            
            if image_table_exists:
                # 提取所有问题编号
                question_nos = [item.get('question_no') for item in optimize_data_list if item.get('question_no')]
                if question_nos:
                    # 构建查询条件，查询所有问题编号的图片
                    placeholders = ', '.join([':q' + str(i) for i in range(len(question_nos))])
                    params = {f'q{i}': q for i, q in enumerate(question_nos)}
                    
                    image_query = text(f"""
                        SELECT entity_id, url
                        FROM test.images
                        WHERE entity_id IN ({placeholders})
                    """)
                    image_result = session.execute(image_query, params)
                    
                    # 按问题编号分组图片
                    for row in image_result:
                        question_images[row.entity_id].append(row.url)
                logger.info(f"查询到 {len(question_images)} 个问题的图片数据")
            else:
                logger.info("test.images 表不存在，跳过图片查询")
        except Exception as e:
            logger.error(f"查询图片数据失败: {e}")
        
        logger.info("开始分析匹配条目")
        for idx, item in enumerate(optimize_data_list):
            if idx % 10 == 0:
                logger.info(f"分析进度: {idx}/{len(optimize_data_list)}")
            
            question_no = item.get('question_no')
            question = item.get('question')
            answer = item.get('answer')
            text_optimized_question = item.get('text_optimized_question')
            text_optimized_answer = item.get('text_optimized_answer')
            optimized_question = item.get('optimized_question')
            optimized_answer = item.get('optimized_answer')
            
            # 检查是否有有效的问题和答案
            if not text_optimized_question or not text_optimized_answer or not optimized_question or not optimized_answer:
                continue
            
            # 构建问答对
            qa1 = {"question": optimized_question, "answer": optimized_answer}  # 多模态优化结果
            qa2 = {"question": text_optimized_question, "answer": text_optimized_answer}  # 文本优化结果
            
            # 分析问答对
            analysis_result = analyzer.analyze_qa_pair(qa1, qa2)
            
            # 提取分析结果
            diagnosis_similarity = analysis_result["diagnosis_similarity"]
            has_diagnosis1 = analysis_result["has_diagnosis1"]
            has_diagnosis2 = analysis_result["has_diagnosis2"]
            qa_similarity = analysis_result["qa_similarity"]
            
            # 检查是否是纯文本数据（没有图片）
            is_text_only = True
            image_count = 0
            
            # 构建结果条目，包含必要的字段
            result_entry = {
                "id_value": str(question_no),
                "doc1_question": optimized_question,
                "doc1_answer": optimized_answer,
                "doc2_question": text_optimized_question,
                "doc2_answer": text_optimized_answer,
                "original_question": question,
                "original_answer": answer,
                "analysis": {
                    "diagnosis_text1": analysis_result.get("diagnosis_text1", ""),
                    "diagnosis_text2": analysis_result.get("diagnosis_text2", ""),
                    "diagnosis_similarity": diagnosis_similarity,
                    "question_similarity": analysis_result.get("question_similarity", 0.0),
                    "answer_similarity": analysis_result.get("answer_similarity", 0.0),
                    "qa_similarity": qa_similarity,
                    "has_diagnosis1": has_diagnosis1,
                    "has_diagnosis2": has_diagnosis2
                }
            }
            
            # 添加到全部条目
            all_entries.append(result_entry)
            
            # 对于纯文本数据，直接视为高相似度
            is_high_similarity = is_text_only or (has_diagnosis1 and has_diagnosis2 and (diagnosis_similarity >= 0.65 or qa_similarity >= 0.7))
            
            # 记录需要更新的条目
            update_entries.append({
                "question_no": question_no,
                "high": 1 if is_high_similarity else 0,
                "diagnosis_similarity": diagnosis_similarity,
                "qa_similarity": qa_similarity
            })
            
            if is_high_similarity:
                high_similarity_count += 1
                # 处理训练格式数据 - 使用文本优化后的问答对
                # 添加图片列表
                images = question_images.get(question_no, [])
                
                # 从图片 URL 中提取文件名
                def extract_image_filename(url):
                    """
                    从图片 URL 中提取文件名
                    """
                    import os
                    # 从 URL 中提取路径部分
                    if '://' in url:
                        path = url.split('://')[-1]
                    else:
                        path = url
                    # 提取文件名
                    filename = os.path.basename(path)
                    return filename
                
                # 提取图片文件名
                image_filenames = []
                for img_url in images:
                    filename = extract_image_filename(img_url)
                    if filename:
                        image_filenames.append(filename)
                
                processed_entry = {
                    "id": str(question_no),
                    "image": image_filenames,
                    "conversations": [
                        {"from": "human", "value": text_optimized_question},
                        {"from": "gpt", "value": text_optimized_answer}
                    ]
                }
                
                # 只添加有完整对话的条目
                if len(processed_entry["conversations"]) >= 2:
                    training_format_data.append(processed_entry)
        
        # 批量更新数据库
        if update_entries:
            try:
                from sqlalchemy import text
                # 构建批量更新语句
                update_query = text("UPDATE test.optimize_data SET high = :high, review_status = 1, diagnosis_similarity = :diagnosis_similarity, qa_similarity = :qa_similarity WHERE question_no = :question_no")
                # 批量执行更新
                session.execute(update_query, update_entries)
                logger.info(f"批量更新 {len(update_entries)} 条数据的 high、review_status、diagnosis_similarity 和 qa_similarity 字段")
            except Exception as e:
                logger.error(f"批量更新数据库时出错: {e}")
        
        # 提交数据库事务
        session.commit()
        
        # 从数据库查询高相似度的问题编号
        high_similarity_question_nos = []
        all_question_nos = []
        
        try:
            # 提取所有问题编号
            question_nos = [item.get('question_no') for item in optimize_data_list if item.get('question_no')]
            all_question_nos = question_nos
            
            if question_nos:
                # 构建查询条件，查询 high=1 的问题编号
                placeholders = ', '.join([':q' + str(i) for i in range(len(question_nos))])
                params = {f'q{i}': q for i, q in enumerate(question_nos)}
                
                high_similarity_query = text(f"""
                    SELECT question_no 
                    FROM test.optimize_data 
                    WHERE question_no IN ({placeholders}) AND high = 1
                """)
                high_similarity_result = session.execute(high_similarity_query, params)
                
                # 提取高相似度的问题编号
                for row in high_similarity_result:
                    high_similarity_question_nos.append(str(row.question_no))
                    
                logger.info(f"从数据库查询到 {len(high_similarity_question_nos)} 条高相似度条目")
        except Exception as e:
            logger.error(f"查询高相似度问题编号时出错: {e}")
        finally:
            session.close()
            engine.dispose()
        
        logger.info(f"分析完成，高相似度条目数: {len(high_similarity_question_nos)}, 总条目数: {len(all_question_nos)}, 训练格式数据数: {len(training_format_data)}")
        
        analysis_result = {
            "all_entries": all_entries,
            "training_format_data": training_format_data,
            "high_similarity_question_nos": high_similarity_question_nos,
            "all_question_nos": all_question_nos
        }
        
        # 保存全部条目
        all_entries_path = f"{output_base}_all.json"
        logger.info(f"保存全部条目到: {all_entries_path}")
        with open(all_entries_path, 'w', encoding='utf-8') as f:
            json.dump(analysis_result["all_entries"], f, ensure_ascii=False, indent=2)
        
        # 保存训练格式数据
        training_format_path = f"{output_base}_training.json"
        logger.info(f"保存训练格式数据到: {training_format_path}")
        with open(training_format_path, 'w', encoding='utf-8') as f:
            json.dump(analysis_result["training_format_data"], f, ensure_ascii=False, indent=2)
        
        logger.info(f"相似度分析完成，保存结果到: {all_entries_path} 和 {training_format_path}")
        
        return {
            "all_entries_path": all_entries_path,
            "training_format_path": training_format_path,
            "high_similarity_count": len(high_similarity_question_nos),
            "high_similarity_question_nos": high_similarity_question_nos,
            "all_question_nos": all_question_nos,
            "all_entries_count": len(analysis_result["all_entries"]),
            "training_format_count": len(analysis_result["training_format_data"]),
            "all_entries": analysis_result["all_entries"]
        }
    except Exception as e:
        logger.error(f"直接进行相似度分析时出错: {e}")
        logger.error(f"错误堆栈: {traceback.format_exc()}")
        # 确保会话和引擎关闭
        try:
            if 'session' in locals():
                session.close()
            if 'engine' in locals():
                engine.dispose()
        except:
            pass
        return {
            "all_entries_path": "",
            "training_format_path": "",
            "high_similarity_count": 0,
            "all_entries_count": 0,
            "training_format_count": 0,
            "all_entries": []
        }