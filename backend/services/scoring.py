"""
评分服务模块
实现回复质量评分逻辑
"""

def calculate_reply_score(reply_data):
    """
    计算单条回复的评分
    
    评分规则：
    1. 采纳状态：accepted_flag=1 得 0.4 分
    2. 用户身份：user_type=3/2/1 分别得 0.3/0.2/0.1 分
    3. 内容详实度：
       - content > 100 字：0.3 分
       - 50 < content <= 100 字：0.2 分
       - 20 < content <= 50 字：0.1 分
       - content <= 20 字：0 分
    
    参数:
        reply_data: 回复数据字典，包含 accepted_flag, user_type, content
    
    返回:
        float: 评分结果 (0-1 之间)
    """
    total_score = 0.0
    
    # 1. 采纳状态评分 (0.4 分)
    accepted_flag = reply_data.get('accepted_flag', 0)
    if accepted_flag == 1:
        total_score += 0.4
    
    # 2. 用户身份评分 (0.3/0.2/0.1 分)
    user_type = reply_data.get('user_type', 1)
    user_type_scores = {
        3: 0.3,
        2: 0.2,
        1: 0.1
    }
    total_score += user_type_scores.get(user_type, 0.1)
    
    # 3. 内容详实度评分 (0.3/0.2/0.1 分)
    content = reply_data.get('content', '')
    content_length = len(str(content).strip())
    
    if content_length > 100:
        total_score += 0.3
    elif content_length > 50:
        total_score += 0.2
    elif content_length > 20:
        total_score += 0.1
    
    # 确保总分不超过 1.0
    total_score = min(total_score, 1.0)
    
    return round(total_score, 1)

def score_all_replies(replies_list, session=None, batch_size=1000):
    """
    批量评分所有回复，支持分批处理
    
    参数:
        replies_list: 回复数据列表
        session: 数据库会话对象（可选）
        batch_size: 每批处理的回复数量
    
    返回:
        list: 包含评分结果的回复列表
    """
    import logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)
    
    total_replies = len(replies_list)
    logger.info(f"开始批量评分，共 {total_replies} 条回复，每批处理 {batch_size} 条")
    
    scored_replies = []
    reply_no_to_score = {}
    
    # 第一步：计算所有回复的评分
    for i, reply in enumerate(replies_list):
        score = calculate_reply_score(reply)
        reply['score'] = score
        scored_replies.append(reply)
        reply_no_to_score[reply.get('reply_no')] = score
        
        # 每处理一批，记录一次进度
        if (i + 1) % batch_size == 0:
            logger.info(f"已处理 {i + 1}/{total_replies} 条回复")
    
    # 第二步：如果提供了会话对象，批量更新数据库
    if session:
        try:
            # 导入 Reply 模型
            from models.models import Reply
            from sqlalchemy import text
            
            # 批量更新，每批处理 batch_size 条
            reply_nos = list(reply_no_to_score.keys())
            total_updates = len(reply_nos)
            logger.info(f"开始批量更新评分到数据库，共 {total_updates} 条记录")
            
            for i in range(0, total_updates, batch_size):
                batch_reply_nos = reply_nos[i:i+batch_size]
                batch_data = [(reply_no, reply_no_to_score[reply_no]) for reply_no in batch_reply_nos]
                
                # 使用批量更新语法
                update_sql = text("""
                    UPDATE test.replies 
                    SET score = :score 
                    WHERE reply_no = :reply_no
                """)
                
                # 批量执行
                session.execute(update_sql, [{'score': score, 'reply_no': reply_no} for reply_no, score in batch_data])
                
                # 每处理一批，提交一次事务
                session.commit()
                logger.info(f"已更新 {min(i + batch_size, total_updates)}/{total_updates} 条回复的评分")
                
        except Exception as e:
            logger.error(f"批量更新评分到数据库失败: {e}")
            if session:
                session.rollback()
    
    logger.info(f"批量评分完成，共处理 {len(scored_replies)} 条回复")
    
    return scored_replies

def get_best_reply_for_question(replies_list, session=None, batch_size=1000):
    """
    为每个问题选择评分最高的回复，并更新到optimize_data表中，支持分批处理
    
    参数:
        replies_list: 回复数据列表
        session: 数据库会话对象（可选）
        batch_size: 每批处理的问题数量
    
    返回:
        dict: 以 question_no 为键，最佳回复为值的字典
    """
    import logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)
    
    from collections import defaultdict
    
    logger.info(f"开始选择最佳回复，共 {len(replies_list)} 条回复")
    
    question_replies = defaultdict(list)
    
    # 按 question_no 分组
    for reply in replies_list:
        question_no = reply.get('question_no')
        if question_no:
            question_replies[question_no].append(reply)
    
    total_questions = len(question_replies)
    logger.info(f"按问题编号分组完成，共 {total_questions} 个问题")
    
    # 展示有多个回复的分组
    multi_reply_groups = 0
    for question_no, replies in question_replies.items():
        if len(replies) > 2:
            multi_reply_groups += 1
            if multi_reply_groups <= 3:  # 只展示前3个示例
                reply_ids = [r.get('reply_no') for r in replies]
                reply_scores = [r.get('score', 0) for r in replies]
                logger.info(f"回复分组示例 - 问题 {question_no}: {len(replies)} 条回复 - 回复编号: {reply_ids} - 评分: {reply_scores}")
    logger.info(f"共有 {multi_reply_groups} 个问题包含超过2条回复")
    
    # 为每个问题选择 score 最高的回复，如果评分相同则选择内容最长的 回复
    best_replies = {}
    question_items = list(question_replies.items())
    
    # 分批处理问题
    for i in range(0, total_questions, batch_size):
        batch_questions = question_items[i:i+batch_size]
        batch_best_replies = {}
        
        for question_no, replies in batch_questions:
            if replies:
                # 先按评分排序，评分相同则按内容长度排序
                best_reply = replies[0]
                
                for reply in replies[1:]:
                    reply_score = reply.get('score', 0)
                    best_score = best_reply.get('score', 0)
                    
                    if reply_score > best_score:
                        best_reply = reply
                    elif reply_score == best_score:
                        # 评分相同，选择内容更长的 回复
                        reply_length = len(str(reply.get('content', '')))
                        best_length = len(str(best_reply.get('content', '')))
                        if reply_length > best_length:
                            best_reply = reply
                
                best_replies[question_no] = best_reply
                batch_best_replies[question_no] = best_reply
        
        # 每处理一批，记录一次进度
        logger.info(f"已处理 {min(i + batch_size, total_questions)}/{total_questions} 个问题")
        
        # 如果提供了会话对象，批量更新到optimize_data表
        if session and batch_best_replies:
            try:
                # 导入 Question 模型
                from models.models import Question
                from sqlalchemy import text
                
                # 批量处理优化数据
                batch_data = []
                for question_no, best_reply in batch_best_replies.items():
                    # 查找对应的问题
                    question_obj = session.query(Question).filter_by(question_no=question_no).first()
                    
                    # 只有当问题对象存在时才进行操作
                    if question_obj:
                        question_content = question_obj.quiz_desc
                        batch_data.append({
                            'question_no': question_no,
                            'answer': best_reply.get('content', ''),
                            'score': best_reply.get('score', 0),
                            'question': question_content,
                            'text_optimized_question': best_reply.get('text_optimized_question', None),
                            'text_optimized_answer': best_reply.get('text_optimized_answer', None),
                            'optimized_question': best_reply.get('optimized_question', None),
                            'optimized_answer': best_reply.get('optimized_answer', None)
                        })
                
                # 批量更新或插入数据
                if batch_data:
                    # 检查optimize_data表是否存在
                    check_table = text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'optimize_data' AND table_schema = 'test')")
                    table_exists = session.execute(check_table).scalar()
                    
                    if table_exists:
                        # 批量处理数据
                        for item in batch_data:
                            # 检查该问题是否已经存在于optimize_data表中
                            check_existing = text("SELECT COUNT(*) FROM test.optimize_data WHERE question_no = :question_no")
                            existing_count = session.execute(check_existing, {'question_no': item['question_no']}).scalar()
                        
                            if existing_count > 0:
                                # 更新现有记录
                                update_sql = text("""
                                    UPDATE test.optimize_data 
                                    SET question = :question, answer = :answer, score = :score,
                                        text_optimized_question = :text_optimized_question,
                                        text_optimized_answer = :text_optimized_answer,
                                        optimized_question = :optimized_question,
                                        optimized_answer = :optimized_answer
                                    WHERE question_no = :question_no
                                """)
                                session.execute(update_sql, item)
                            else:
                                # 插入新记录
                                insert_sql = text("""
                                    INSERT INTO test.optimize_data (question_no, answer, score, question,
                                        text_optimized_question, text_optimized_answer,
                                        optimized_question, optimized_answer)
                                    VALUES (:question_no, :answer, :score, :question,
                                        :text_optimized_question, :text_optimized_answer,
                                        :optimized_question, :optimized_answer)
                                """)
                                session.execute(insert_sql, item)
                        
                        # 每处理一批，提交一次事务
                        session.commit()
                        logger.info(f"已更新 {len(batch_data)} 条优化数据")
            except Exception as e:
                logger.error(f"更新optimize_data表失败: {e}")
                import traceback
                logger.error(traceback.format_exc())
                if session:
                    session.rollback()
                    logger.info("事务已回滚")

    logger.info(f"最佳回复选择完成，共处理 {len(best_replies)} 个问题")
    
    return best_replies