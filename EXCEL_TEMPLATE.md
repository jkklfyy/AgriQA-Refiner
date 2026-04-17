# Excel 文件格式说明

## 文件要求

上传的 Excel 文件应包含以下三个工作表（Sheet）：

### 1. questions 工作表（问题表）

**必需列：**
- `question_no`: 问题编号（唯一标识，用于关联回复和图片）
- `quiz_desc`: 问题内容

**示例数据：**

| question_no | quiz_desc |
|-------------|-----------|
| qa_1920038098029314050 | 图中甜瓜叶片上出现多个散生的黄褐色小斑点... |
| qa_1920038098029314051 | 玉米叶片出现黄绿相间的条纹... |

### 2. replies 工作表（回复表）

**必需列：**
- `id`: 回复 ID（唯一标识）
- `question_no`: 关联的问题编号（与 questions 表关联）
- `content`: 回复内容

**必需评分列：**
- `accepted_flag`: 采纳状态（1=已采纳，0=未采纳）
- `user_type`: 用户类型（3/2/1，对应专家/达人/普通用户）

**可选列：**
- `created_at`: 回复时间

**示例数据：**

| id | question_no | content | accepted_flag | user_type | created_at |
|----|-------------|---------|---------------|-----------|------------|
| 1001 | qa_1920038098029314050 | 诊断结论：该症状高度疑似甜瓜炭疽病... | 1 | 3 | 2024-01-15 10:35:00 |
| 1002 | qa_1920038098029314050 | 可能是叶斑病，建议喷洒杀菌剂... | 0 | 1 | 2024-01-15 10:40:00 |
| 1003 | qa_1920038098029314051 | 这是玉米粗缩病的典型症状... | 1 | 2 | 2024-01-15 11:25:00 |

**评分规则说明：**

系统会根据以下规则自动计算每条回复的评分（evl）：

1. **采纳状态分**（0.4 分）
   - accepted_flag = 1 → 得 0.4 分
   - accepted_flag = 0 → 得 0 分

2. **用户身份分**（0.3/0.2/0.1 分）
   - user_type = 3（专家）→ 得 0.3 分
   - user_type = 2（达人）→ 得 0.2 分
   - user_type = 1（普通用户）→ 得 0.1 分

3. **内容详实度分**（0.3/0.2/0.1 分）
   - content 长度 > 100 字 → 得 0.3 分
   - 50 < content 长度 ≤ 100 → 得 0.2 分
   - 20 < content 长度 ≤ 50 → 得 0.1 分
   - content 长度 ≤ 20 → 得 0 分

**总分** = 采纳状态分 + 用户身份分 + 内容详实度分（最高 1.0 分）

### 3. images 工作表（图片表）

**必需列：**
- `entity_id`: 实体 ID（与 question_no 对应，一个问题可对应多张图片）
- `url`: 图片的完整 URL 路径

**可选列：**
- `created_at`: 上传时间

**示例数据：**

| entity_id | url | created_at |
|-----------|-----|------------|
| qa_1920038098029314050 | https://example.com/images/e23282eb4dba45c38a173396445129e7.jpeg | 2024-01-15 10:30:00 |
| qa_1920038098029314050 | https://example.com/images/6b20b9dc7a9741e9812741daf1893296.jpeg | 2024-01-15 10:30:00 |
| qa_1920038098029314050 | https://example.com/images/afd17b058540476182c731cbd4b25f3d.jpeg | 2024-01-15 10:30:00 |
| qa_1920038098029314051 | https://example.com/images/corn_disease_001.jpeg | 2024-01-15 11:20:00 |

**注意：**
- 一个 entity_id 可以对应多行（多张图片）
- 系统会自动从 URL 中提取文件名（去掉前缀）
- 导出的 JSON 中只包含文件名，不包含完整 URL

## Excel 文件示例结构

```
┌─────────────────────────────────────┐
│ Sheet: questions                    │
├──────────────┬──────────────────────┤
│ question_no  │ quiz_desc            │
├──────────────┼──────────────────────┤
│ qa_001       │ 内容 1...             │
│ qa_002       │ 内容 2...             │
└──────────────┴──────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Sheet: replies                                      │
├────┬──────────────┬──────────┬─────────────┬───────┤
│ id │ question_no  │ content  │ accepted_   │ user_ │
│    │              │          │ flag        │ type  │
├──────────────────┼──────────┼─────────────┼───────┤
│ 1  │ qa_001       │ 回复内容 │ 1           │ 3     │
│ 2  │ qa_001       │ 回复内容 │ 0           │ 1     │
│ 3  │ qa_002       │ 回复内容 │ 1           │ 2     │
└────┴──────────────┴──────────┴─────────────┴───────┘

┌─────────────────────────────────────────────────────┐
│ Sheet: images                                       │
├──────────────┬─────────────────────────────────────┤
│ entity_id    │ url                                 │
├──────────────┼─────────────────────────────────────┤
│ qa_001       │ https://.../image1.jpeg             │
│ qa_001       │ https://.../image2.jpeg             │
│ qa_002       │ https://.../image3.jpeg             │
└──────────────┴─────────────────────────────────────┘
```

## 导出 JSON 格式

系统会将数据导出为符合 Qwen 大模型训练格式的 JSON 文件：

```json
[
  {
    "id": "qa_1920038098029314050",
    "image": [
      "e23282eb4dba45c38a173396445129e7.jpeg",
      "6b20b9dc7a9741e9812741daf1893296.jpeg",
      "afd17b058540476182c731cbd4b25f3d.jpeg"
    ],
    "conversations": [
      {
        "from": "human",
        "value": "<image> <image> <image> 图中甜瓜叶片上出现多个散生的黄褐色小斑点..."
      },
      {
        "from": "gpt",
        "value": "诊断结论：该症状高度疑似**甜瓜炭疽病**..."
      }
    ]
  }
]
```

**导出规则：**
1. 每个问题生成一条训练数据
2. 图片标签数量与图片数量一致
3. GPT 回复选择同一问题下评分（evl）最高的回复内容
4. 图片 URL 自动转换为文件名（去掉路径前缀）

## 创建 Excel 文件的步骤

### 方法 1：使用 Microsoft Excel

1. 打开 Microsoft Excel
2. 创建第一个工作表，命名为 `questions`
3. 输入问题数据，确保包含必需的列
4. 添加第二个工作表，命名为 `replies`
5. 输入回复数据
6. 添加第三个工作表，命名为 `images`
7. 输入图片数据
8. 保存为 `.xlsx` 格式

### 方法 2：使用 Python 和 pandas

```python
import pandas as pd

# 创建示例数据
questions_data = {
    'question_no': ['qa_001', 'qa_002'],
    'title': ['标题 1', '标题 2'],
    'content': ['问题内容 1...', '问题内容 2...']
}

replies_data = {
    'id': [1, 2, 3],
    'question_no': ['qa_001', 'qa_001', 'qa_002'],
    'content': ['回复内容 1...', '回复内容 2...', '回复内容 3...'],
    'accepted_flag': [1, 0, 1],
    'user_type': [3, 1, 2]
}

images_data = {
    'entity_id': ['qa_001', 'qa_001', 'qa_002'],
    'url': [
        'https://example.com/img1.jpeg',
        'https://example.com/img2.jpeg',
        'https://example.com/img3.jpeg'
    ]
}

# 创建 DataFrame
df_questions = pd.DataFrame(questions_data)
df_replies = pd.DataFrame(replies_data)
df_images = pd.DataFrame(images_data)

# 保存到 Excel
with pd.ExcelWriter('training_data.xlsx', engine='openpyxl') as writer:
    df_questions.to_excel(writer, sheet_name='questions', index=False)
    df_replies.to_excel(writer, sheet_name='replies', index=False)
    df_images.to_excel(writer, sheet_name='images', index=False)

print('Excel 文件创建成功！')
```

## 常见问题

### Q: Excel 文件上传后解析失败？
A: 检查工作表名称是否正确（必须是 questions、replies、images），列名是否匹配。

### Q: 图片没有正确显示在导出文件中？
A: 检查 images 表中的 entity_id 是否与 questions 表中的 question_no 完全一致。

### Q: 评分结果不正确？
A: 检查 replies 表中的 accepted_flag 和 user_type 列的值是否符合要求。

### Q: 一个问题有多张图片，会全部导出吗？
A: 会的，系统会自动收集同一个 entity_id 对应的所有图片，并全部包含在导出文件中。
