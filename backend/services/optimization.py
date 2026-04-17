"""
优化服务模块
实现问答对优化功能
"""

import json
import os
import time
from typing import List, Dict, Any, Tuple
import requests
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('optimization.log'),
        logging.StreamHandler()
    ]
)

class TextOptimizer:
    """
    文本优化器，使用文本模型优化问答对
    """
    def __init__(self, api_key: str, api_base_url: str, model: str):
        """
        初始化文本优化器
        
        Args:
            api_key: 阿里云 DashScope API Key
            api_base_url: API 基础 URL
            model: 模型名称
        """
        self.api_key = api_key
        self.api_base_url = api_base_url
        self.model = model
        self.max_retries = 5
        self.timeout = 60
    
    def _call_api(self, messages: List[Dict], max_tokens: int = 2000) -> str:
        """
        调用 API
        
        Args:
            messages: 消息列表
            max_tokens: 最大生成 token 数
            
        Returns:
            API 响应文本
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "top_p": 0.9,
            "stream": False
        }
        
        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    f"{self.api_base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=self.timeout
                )
                
                if response.status_code == 200:
                    result = response.json()
                    return result["choices"][0]["message"]["content"]
                else:
                    error_data = response.json() if response.text else {}
                    error_message = error_data.get("error", {}).get("message", "") if error_data else response.text
                    logging.warning(f"API 调用失败 (尝试 {attempt+1}/{self.max_retries}): {response.status_code} - {error_message}")
                    
                    if attempt < self.max_retries - 1:
                        wait_time = min(2 ** attempt, 60)
                        time.sleep(wait_time)
            except requests.exceptions.RequestException as e:
                logging.warning(f"网络错误 (尝试 {attempt+1}/{self.max_retries}): {e}")
                if attempt < self.max_retries - 1:
                    wait_time = min(2 ** attempt, 60)
                    time.sleep(wait_time)
        
        raise Exception(f"API 调用失败，已达最大重试次数 {self.max_retries}")
    
    def optimize_question(self, original_question: str, prompt: str) -> str:
        """
        优化问题
        
        Args:
            original_question: 原始问题
            prompt: 优化提示词
            
        Returns:
            优化后的问题
        """
        messages = [
            {
                "role": "system",
                "content": prompt
            },
            {
                "role": "user",
                "content": f"原始问题：{original_question}\n\n请优化此问题。"
            }
        ]
        
        try:
            optimized_question = self._call_api(messages, max_tokens=500)
            return optimized_question.strip()
        except Exception as e:
            logging.error(f"问题优化失败: {e}")
            return original_question
    
    def optimize_answer(self, original_answer: str, optimized_question: str, prompt: str) -> str:
        """
        优化答案
        
        Args:
            original_answer: 原始答案
            optimized_question: 优化后的问题
            prompt: 优化提示词
            
        Returns:
            优化后的答案
        """
        messages = [
            {
                "role": "system",
                "content": prompt
            },
            {
                "role": "user",
                "content": f"优化后的问题：{optimized_question}\n\n原始回答：{original_answer}\n\n请优化此回答。"
            }
        ]
        
        try:
            optimized_answer = self._call_api(messages, max_tokens=1500)
            return optimized_answer.strip()
        except Exception as e:
            logging.error(f"答案优化失败: {e}")
            return original_answer
    
    def process_item(self, item: Dict, prompts: Dict) -> Dict:
        """
        处理单个数据项
        
        Args:
            item: 数据项
            prompts: 提示词配置
            
        Returns:
            处理后的结果
        """
        item_id = item.get("id", "unknown")
        original_question = item["conversations"][0]["value"]
        original_answer = item["conversations"][1]["value"]
        
        logging.info(f"开始处理项目 {item_id}")
        
        start_time = time.time()
        
        try:
            # 优化问题
            optimized_question = self.optimize_question(original_question, prompts["question"])
            
            # 优化答案
            optimized_answer = self.optimize_answer(original_answer, optimized_question, prompts["answer"])
            
            processing_time = time.time() - start_time
            
            result = {
                "id": item_id,
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
    
    def process_batch(self, data: List[Dict], prompts: Dict, max_workers: int = 3) -> List[Dict]:
        """
        批量处理数据
        
        Args:
            data: 数据列表
            prompts: 提示词配置
            max_workers: 最大工作线程数
            
        Returns:
            处理结果列表
        """
        results = []
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_item = {executor.submit(self.process_item, item, prompts): item for item in data}
            
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
        
        return results

class VLOptimizer(TextOptimizer):
    """
    多模态优化器，使用 VL 模型优化问答对
    """
    def __init__(self, api_key: str, api_base_url: str, model: str, base_image_dir: str = None):
        """
        初始化多模态优化器
        
        Args:
            api_key: 阿里云 DashScope API Key
            api_base_url: API 基础 URL
            model: 模型名称
            base_image_dir: 图片基础目录
        """
        super().__init__(api_key, api_base_url, model)
        self.base_image_dir = base_image_dir or ""
    
    def _load_image(self, image_path: str) -> str:
        """
        加载图片（简化实现，实际项目中可能需要处理图片）
        
        Args:
            image_path: 图片路径
            
        Returns:
            图片路径
        """
        return image_path
    
    def optimize_question(self, original_question: str, prompt: str, image_path: str = None) -> str:
        """
        优化问题（支持图片）
        
        Args:
            original_question: 原始问题
            prompt: 优化提示词
            image_path: 图片路径
            
        Returns:
            优化后的问题
        """
        content = []
        
