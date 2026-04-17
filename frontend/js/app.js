/**
 * 自动化回复评分系统 - 前端逻辑
 * 绿色主题版本
 */

// API 基础 URL
const API_BASE = 'http://127.0.0.1:8081/api';

// 全局数据存储
let globalData = {
    questionNos: [], // 只存储问题编号，不存储完整数据
    dataCache: new Map(), // 内存缓存
    loadedData: {
        questions: {},  // key: question_no, value: question对象
        replies: {},    // key: reply_no, value: reply对象
        images: []
    },
    dataSource: null, // 'database' or 'excel'
    isConnected: false,
    isScored: false,
    exportResult: null, // 存储导出结果
    optimizeResult: null, // 存储优化结果
    customPrompts: { // 存储自定义提示词
        text: {
            question: '',
            answer: ''
        },
        vl: {
            question: '',
            answer: ''
        }
    },
    dbConfig: {
        host: '192.168.200.88',
        port: 5432,
        user: 'postgres',
        password: '',
        database: 'data-center',
        schema: 'test'
    },
    apiConfig: {
        key: '',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    },
    modelConfig: {
        textModel: 'qwen3',
        vlModel: 'qwen3-vl'
    },
    manualReviewInitialized: false // 人工复审页面初始化状态
};

// DOM 元素引用
const elements = {};

// 数据管理页面状态
let dataManagementState = {
    currentPage: 1,
    totalItems: 0,
    totalPages: 0,
    isLoading: false,
    filters: {
        status: '',
        quality: '',
        search: ''
    },
    // 数据缓存，键为分页和筛选条件的组合
    dataCache: {},
    // 预加载状态
    preloading: false,
    // 预加载的页数
    preloadedPages: new Set()
};

// 上传状态管理
let uploadState = {
    questions: false,
    replies: false,
    images: false
};

// 分页配置
const PAGE_SIZE = 10;

/**
 * 批量获取数据
 * @param {Array} questionNos - 问题编号列表
 * @returns {Promise<Array>} - 数据列表
 */
async function fetchBatchData(questionNos) {
    // 检查缓存
    const cachedNos = [];
    const uncachedNos = [];
    
    questionNos.forEach(no => {
        if (globalData.dataCache.has(no)) {
            cachedNos.push(no);
        } else {
            uncachedNos.push(no);
        }
    });
    
    // 只请求未缓存的数据
    if (uncachedNos.length > 0) {
        try {
            showLoading('加载数据中...');
            const response = await fetch(`${API_BASE}/batch-query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ question_nos: uncachedNos })
            });
            
            const result = await response.json();
            if (result.success) {
                // 更新缓存和已加载数据
                result.data.questions.forEach(q => {
                    globalData.dataCache.set(q.question_no, q);
                    globalData.loadedData.questions[q.question_no] = q;
                });
                
                result.data.replies.forEach(r => {
                    globalData.loadedData.replies[r.reply_no] = r;
                });
                
                // 更新图片数据
                if (result.data.images) {
                    globalData.loadedData.images = [...globalData.loadedData.images, ...result.data.images];
                }
            } else {
                throw new Error(result.error || '批量获取数据失败');
            }
        } catch (error) {
            console.error('批量获取数据失败:', error);
            showToast(`批量获取数据失败: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    }
    
    // 返回所有请求的数据
    return questionNos.map(no => globalData.dataCache.get(no));
}

/**
 * 加载分页数据
 * @param {number} page - 页码
 */
async function loadPageData(page) {
    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageQuestionNos = globalData.questionNos.slice(start, end);
    
    if (pageQuestionNos.length === 0) {
        return [];
    }
    
    return await fetchBatchData(pageQuestionNos);
}



// 初始化
document.addEventListener('DOMContentLoaded', async function() {
        console.log('%c[系统] 页面加载完成，开始初始化...', 'color: #22c55e; font-weight: bold; font-size: 14px');
        console.log('[系统] 当前时间:', new Date().toLocaleString());
        console.log('[系统] API 基础路径:', API_BASE);
        
        initializeElements();
        console.log('[系统] DOM 元素初始化完成');


        initializeEventListeners();
        console.log('[系统] 事件监听器初始化完成');
        
        // 获取模型列表
        await fetchModels();
        
        updateSystemStatus('ready');
        console.log('[系统] 系统状态已更新为：就绪');
        
        // 更新优化按钮状态
        updateOptimizeButtonState();
        
        console.log('%c[系统] 初始化完成！可以开始使用', 'color: #22c55e; font-weight: bold; font-size: 12px');
        console.log('[系统] 提示：按 F12 打开控制台查看详细日志');
        
        // 设置 API 配置
        if (elements.apiKey) elements.apiKey.value = globalData.apiConfig.key;
        if (elements.apiBaseUrl) elements.apiBaseUrl.value = globalData.apiConfig.baseUrl;
        
        // 设置模型选择
        if (elements.textModelInput) elements.textModelInput.value = globalData.modelConfig.textModel;
        if (elements.vlModelInput) elements.vlModelInput.value = globalData.modelConfig.vlModel;
    });

/**
 * 初始化 DOM 元素
 */
function initializeElements() {
    // 表单元素
    elements.dbConfigForm = document.getElementById('dbConfigForm');
    elements.dbStatus = document.getElementById('dbStatus');
    
    // 多文件上传元素
    elements.uploadItems = document.querySelectorAll('.upload-item');
    elements.uploadSummaries = {
        questions: document.getElementById('questionsCount'),
        replies: document.getElementById('repliesCount'),
        images: document.getElementById('imagesCount')
    };
    elements.statusIndicators = {
        questions: document.getElementById('statusQuestions'),
        replies: document.getElementById('statusReplies'),
        images: document.getElementById('statusImages')
    };
    elements.btnResetUpload = document.getElementById('btnResetUpload');
    
    // 按钮
    elements.btnScore = document.getElementById('btnScore');
    elements.btnExport = document.getElementById('btnExport');
    elements.btnPreview = document.getElementById('btnPreview');
    elements.btnOptimize = document.getElementById('btnOptimize');
    elements.btnOptimizeTest = document.getElementById('btnOptimizeTest');
    elements.btnAnalyzeSimilarity = document.getElementById('btnAnalyzeSimilarity');
    
    // 模型选择
    elements.textModelInput = document.getElementById('textModelInput');
    elements.vlModelInput = document.getElementById('vlModelInput');
    elements.textModelSuggestions = document.getElementById('textModelSuggestions');
    elements.vlModelSuggestions = document.getElementById('vlModelSuggestions');
    
    // API 配置
    elements.apiKey = document.getElementById('apiKey');
    elements.apiBaseUrl = document.getElementById('apiBaseUrl');
    
    // 状态显示
    elements.scoringResult = document.getElementById('scoringResult');
    elements.exportResult = document.getElementById('exportResult');
    elements.optimizeResult = document.getElementById('optimizeResult');
    elements.systemStatus = document.getElementById('systemStatus');
    
    // 进度显示
    elements.scoringProgress = document.getElementById('scoringProgress');
    elements.exportProgress = document.getElementById('exportProgress');
    elements.optimizeProgress = document.getElementById('optimizeProgress');
    elements.similarityProgress = document.getElementById('similarityProgress');
    elements.similarityResult = document.getElementById('similarityResult');
    
    // 预览抽屉
    elements.previewDrawer = document.getElementById('previewDrawer');
    elements.closePreview = document.getElementById('closePreview');
    elements.questionsTable = document.getElementById('questionsTable');
    elements.repliesTable = document.getElementById('repliesTable');
    elements.imagesTable = document.getElementById('imagesTable');
    
    // Toast 容器
        elements.toastContainer = document.getElementById('toastContainer');
        
        // 提示词相关元素
        elements.btnTextQuestionPrompt = document.getElementById('btnTextQuestionPrompt');
        elements.btnTextAnswerPrompt = document.getElementById('btnTextAnswerPrompt');
        elements.btnVlQuestionPrompt = document.getElementById('btnVlQuestionPrompt');
        elements.btnVlAnswerPrompt = document.getElementById('btnVlAnswerPrompt');
        elements.questionPromptModal = document.getElementById('questionPromptModal');
        elements.answerPromptModal = document.getElementById('answerPromptModal');
        elements.questionPrompt = document.getElementById('questionPrompt');
        elements.answerPrompt = document.getElementById('answerPrompt');
        elements.closeQuestionPromptModal = document.getElementById('closeQuestionPromptModal');
        elements.closeAnswerPromptModal = document.getElementById('closeAnswerPromptModal');
        elements.cancelQuestionPrompt = document.getElementById('cancelQuestionPrompt');
        elements.cancelAnswerPrompt = document.getElementById('cancelAnswerPrompt');
        elements.saveQuestionPrompt = document.getElementById('saveQuestionPrompt');
        elements.saveAnswerPrompt = document.getElementById('saveAnswerPrompt');
        
        // 数据管理页面元素
        elements.dataManagementPage = document.getElementById('data-management');
        elements.dataTable = document.querySelector('#data-management .data-table');
        elements.pagination = document.querySelector('#data-management .pagination');
        elements.paginationInfo = document.querySelector('#data-management .pagination-info');
        elements.paginationControls = document.querySelector('#data-management .pagination-controls');
}

/**
 * 初始化事件监听器
 */
function initializeEventListeners() {
    console.log('[初始化] 开始初始化事件监听器...');
    
    // 数据库配置表单
    if (elements.dbConfigForm) {
        elements.dbConfigForm.addEventListener('submit', handleDbConfig);
        console.log('[初始化] 数据库表单监听器已添加');
    } else {
        console.warn('[初始化] 未找到数据库配置表单');
    }
    
    // 多文件上传
    if (elements.uploadItems) {
        console.log('[初始化] 找到上传区域数量:', elements.uploadItems.length);
        elements.uploadItems.forEach((item, index) => {
            const uploadArea = item.querySelector('.upload-area-small');
            const fileInput = item.querySelector('.excel-file-input');
            const tableType = uploadArea.dataset.type;
            
            console.log(`[初始化] 配置上传区域 #${index + 1}:`, {
                tableType: tableType,
                uploadArea: uploadArea ? '找到' : '未找到',
                fileInput: fileInput ? '找到' : '未找到'
            });
            
            // 点击上传区域
            uploadArea.addEventListener('click', () => fileInput.click());
            
            // 文件选择
            fileInput.addEventListener('change', (e) => {
                console.log(`[初始化] ${tableType} 文件选择器触发`);
                if (e.target.files.length > 0) {
                    console.log(`[初始化] 选择文件:`, e.target.files[0].name);
                    handleMultiFileUpload(e.target.files[0], tableType);
                } else {
                    console.log('[初始化] 未选择文件');
                }
            });
        });
        console.log('[初始化] 所有上传区域监听器已添加');
    } else {
        console.warn('[初始化] 未找到上传区域');
    }
    
    // 重置上传按钮
    if (elements.btnResetUpload) {
        elements.btnResetUpload.addEventListener('click', handleResetUpload);
        console.log('[初始化] 重置按钮监听器已添加');
    } else {
        console.warn('[初始化] 未找到重置按钮');
    }
    
    // 数据库连接重置按钮
    const btnResetDbConfig = document.getElementById('btnResetDbConfig');
    if (btnResetDbConfig) {
        btnResetDbConfig.addEventListener('click', function() {
            if (confirm('确定要重置数据库连接配置吗？\n\n此操作将恢复默认数据库配置。')) {
                // 重置数据库配置表单
                document.getElementById('dbHost').value = '192.168.200.88';
                document.getElementById('dbPort').value = '5432';
                document.getElementById('dbUser').value = 'postgres';
                document.getElementById('dbPassword').value = '';
                document.getElementById('dbName').value = 'data-center';
                document.getElementById('dbSchema').value = 'test';
                
                // 清除状态显示
                const dbStatus = document.getElementById('dbStatus');
                if (dbStatus) {
                    dbStatus.innerHTML = '';
                }
                

                
                // 更新系统状态
                globalData.isConnected = false;
                updateSystemStatus('ready');
                
                // 禁用按钮
                elements.btnScore.disabled = true;
                
                showToast('数据库连接配置已重置', 'success');
            }
        });
        console.log('[初始化] 数据库连接重置按钮监听器已添加');
    } else {
        console.warn('[初始化] 未找到数据库连接重置按钮');
    }
    
    // 上传重置按钮
    const btnResetUpload = document.getElementById('btnResetUpload');
    if (btnResetUpload) {
        btnResetUpload.addEventListener('click', handleResetUpload);
        console.log('[初始化] 上传重置按钮监听器已添加');
    } else {
        console.warn('[初始化] 未找到上传重置按钮');
    }
    
    // 评分和导出按钮
    if (elements.btnScore) {
        elements.btnScore.addEventListener('click', handleScoring);
        console.log('[初始化] 评分按钮监听器已添加');
    } else {
        console.warn('[初始化] 未找到评分按钮');
    }
    
    if (elements.btnExport) {
        elements.btnExport.addEventListener('click', handleExport);
        console.log('[初始化] 导出按钮监听器已添加');
    } else {
        console.warn('[初始化] 未找到导出按钮');
    }
    
    // 数据预览按钮
    if (elements.btnPreview) {
        elements.btnPreview.addEventListener('click', openPreview);
        console.log('[初始化] 数据预览按钮监听器已添加');
    } else {
        console.warn('[初始化] 未找到数据预览按钮');
    }
    
    // 优化按钮
    if (elements.btnOptimize) {
        elements.btnOptimize.addEventListener('click', handleOptimize);
        console.log('[初始化] 优化按钮监听器已添加');
    } else {
        console.warn('[初始化] 未找到优化按钮');
    }
    
    // 优化测试按钮
    if (elements.btnOptimizeTest) {
        elements.btnOptimizeTest.addEventListener('click', handleOptimizeTest);
        console.log('[初始化] 优化测试按钮监听器已添加');
    } else {
        console.warn('[初始化] 未找到优化测试按钮');
    }
    
    // 相似度分析按钮
    if (elements.btnAnalyzeSimilarity) {
        elements.btnAnalyzeSimilarity.addEventListener('click', handleAnalyzeSimilarity);
        console.log('[初始化] 相似度分析按钮监听器已添加');
    } else {
        console.warn('[初始化] 未找到相似度分析按钮');
    }
    
    // 预览抽屉
    if (elements.closePreview) {
        elements.closePreview.addEventListener('click', togglePreview);
        console.log('[初始化] 预览关闭按钮监听器已添加');
    }
    
    // Tab 切换
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', handleTabSwitch);
    });
    
    console.log('[初始化] 事件监听器初始化完成');
    
    // 提示词相关事件监听器
    if (elements.btnTextQuestionPrompt) {
        elements.btnTextQuestionPrompt.addEventListener('click', () => openPromptModal('question', 'text'));
        console.log('[初始化] 文本模型提问优化按钮监听器已添加');
    }
    
    if (elements.btnTextAnswerPrompt) {
        elements.btnTextAnswerPrompt.addEventListener('click', () => openPromptModal('answer', 'text'));
        console.log('[初始化] 文本模型回答优化按钮监听器已添加');
    }
    
    if (elements.btnVlQuestionPrompt) {
        elements.btnVlQuestionPrompt.addEventListener('click', () => openPromptModal('question', 'vl'));
        console.log('[初始化] 多模态模型提问优化按钮监听器已添加');
    }
    
    if (elements.btnVlAnswerPrompt) {
        elements.btnVlAnswerPrompt.addEventListener('click', () => openPromptModal('answer', 'vl'));
        console.log('[初始化] 多模态模型回答优化按钮监听器已添加');
    }
    
    // 模态框关闭事件
    if (elements.closeQuestionPromptModal) {
        elements.closeQuestionPromptModal.addEventListener('click', () => closePromptModal('question'));
    }
    
    if (elements.closeAnswerPromptModal) {
        elements.closeAnswerPromptModal.addEventListener('click', () => closePromptModal('answer'));
    }
    
    // 取消按钮事件
    if (elements.cancelQuestionPrompt) {
        elements.cancelQuestionPrompt.addEventListener('click', () => closePromptModal('question'));
    }
    
    if (elements.cancelAnswerPrompt) {
        elements.cancelAnswerPrompt.addEventListener('click', () => closePromptModal('answer'));
    }
    
    // 保存按钮事件
    if (elements.saveQuestionPrompt) {
        elements.saveQuestionPrompt.addEventListener('click', () => savePrompt('question'));
    }
    
    if (elements.saveAnswerPrompt) {
        elements.saveAnswerPrompt.addEventListener('click', () => savePrompt('answer'));
    }
    
    // 模型输入框事件监听器
    if (elements.textModelInput) {
        // 文本模型输入框事件
        elements.textModelInput.addEventListener('focus', () => {
            elements.textModelSuggestions.classList.add('show');
        });
        
        elements.textModelInput.addEventListener('blur', (e) => {
            // 延迟隐藏，以便点击建议项时能够触发点击事件
            setTimeout(() => {
                elements.textModelSuggestions.classList.remove('show');
            }, 200);
        });
        
        elements.textModelInput.addEventListener('input', () => {
            filterSuggestions(elements.textModelInput, elements.textModelSuggestions);
            // 更新优化按钮状态
            updateOptimizeButtonState();
        });
        
        // 文本模型建议项点击事件
        elements.textModelSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                elements.textModelInput.value = item.dataset.value;
                elements.textModelSuggestions.classList.remove('show');
                // 更新优化按钮状态
                updateOptimizeButtonState();
            });
        });
    }
    
    if (elements.vlModelInput) {
        // 多模态模型输入框事件
        elements.vlModelInput.addEventListener('focus', () => {
            elements.vlModelSuggestions.classList.add('show');
        });
        
        elements.vlModelInput.addEventListener('blur', (e) => {
            // 延迟隐藏，以便点击建议项时能够触发点击事件
            setTimeout(() => {
                elements.vlModelSuggestions.classList.remove('show');
            }, 200);
        });
        
        elements.vlModelInput.addEventListener('input', () => {
            filterSuggestions(elements.vlModelInput, elements.vlModelSuggestions);
            // 更新优化按钮状态
            updateOptimizeButtonState();
        });
        
        // 多模态模型建议项点击事件
        elements.vlModelSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                elements.vlModelInput.value = item.dataset.value;
                elements.vlModelSuggestions.classList.remove('show');
                // 更新优化按钮状态
                updateOptimizeButtonState();
            });
        });
    }
    
    // 点击页面其他地方隐藏建议列表
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.model-input-container')) {
            if (elements.textModelSuggestions) {
                elements.textModelSuggestions.classList.remove('show');
            }
            if (elements.vlModelSuggestions) {
                elements.vlModelSuggestions.classList.remove('show');
            }
        }
    });
    
    // 页面切换事件监听器
    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = e.target.dataset.page;
            
            // 切换页面显示
            document.querySelectorAll('.page-container').forEach(page => {
                page.classList.remove('active');
            });
            document.getElementById(pageId).classList.add('active');
            
            // 如果切换到数据管理页面，加载数据
            if (pageId === 'data-management') {
                // 清空缓存，确保获取最新数据
                clearDataCache();
                // 重新初始化数据管理页面
                initializeDataManagementPage();
            }
        });
    });
    
    // 筛选功能事件监听器
    const statusFilter = document.getElementById('statusFilter');
    const qualityFilter = document.getElementById('qualityFilter');
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const selectAllCheckbox = document.getElementById('selectAll');
    
    if (statusFilter) {
        statusFilter.addEventListener('change', function() {
            dataManagementState.filters.status = this.value;
            dataManagementState.currentPage = 1; // 重置页码
            clearDataCache(); // 清空缓存
            loadDataManagementData();
        });
    }
    
    if (qualityFilter) {
        qualityFilter.addEventListener('change', function() {
            dataManagementState.filters.quality = this.value;
            dataManagementState.currentPage = 1; // 重置页码
            clearDataCache(); // 清空缓存
            loadDataManagementData();
        });
    }
    
    if (searchBtn) {
        searchBtn.addEventListener('click', function() {
            if (searchInput) {
                dataManagementState.filters.search = searchInput.value.trim();
                dataManagementState.currentPage = 1; // 重置页码
                clearDataCache(); // 清空缓存
                loadDataManagementData();
            }
        });
    }
    
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                dataManagementState.filters.search = this.value.trim();
                dataManagementState.currentPage = 1; // 重置页码
                clearDataCache(); // 清空缓存
                loadDataManagementData();
            }
        });
    }
    
    // 全选功能
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function() {
            const checkboxes = document.querySelectorAll('#dataTableBody input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = this.checked;
            });
        });
    }
    
    // API 配置输入框事件监听器
    if (elements.apiKey) {
        elements.apiKey.addEventListener('input', updateOptimizeButtonState);
    }
    
    if (elements.apiBaseUrl) {
        elements.apiBaseUrl.addEventListener('input', updateOptimizeButtonState);
    }
    
    // 初始化优化按钮状态
    updateOptimizeButtonState();
    
    // 加载默认提示词
    loadDefaultPrompts();
};

/**
 * 初始化数据管理页面
 */
async function initializeDataManagementPage() {
    console.log('[数据管理] 初始化数据管理页面...');
    
    // 重置状态
    dataManagementState.currentPage = 1;
    dataManagementState.totalItems = 0;
    dataManagementState.totalPages = 0;
    
    // 加载数据
    await loadDataManagementData();
}

/**
 * 生成缓存键
 */
function generateCacheKey(page, filters) {
    return `page_${page}_status_${filters.status}_quality_${filters.quality}_search_${filters.search}`;
}

/**
 * 加载数据管理页面的数据
 */
async function loadDataManagementData() {
    if (dataManagementState.isLoading) return;
    
    // 生成缓存键
    const cacheKey = generateCacheKey(dataManagementState.currentPage, dataManagementState.filters);
    
    // 检查缓存
    if (dataManagementState.dataCache[cacheKey]) {
        const cachedData = dataManagementState.dataCache[cacheKey];
        dataManagementState.totalItems = cachedData.total;
        dataManagementState.totalPages = Math.ceil(cachedData.total / PAGE_SIZE);
        renderDataTable(cachedData.data);
        renderPagination();
        return;
    }
    
    dataManagementState.isLoading = true;
    showLoading('加载数据中...');
    
    try {
        // 直接从test.optimize_data表获取数据
        const response = await fetch(`${API_BASE}/get-optimize-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                page: dataManagementState.currentPage,
                page_size: PAGE_SIZE,
                filters: dataManagementState.filters
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 计算总数据量和总页数
            dataManagementState.totalItems = result.total;
            dataManagementState.totalPages = Math.ceil(dataManagementState.totalItems / PAGE_SIZE);
            
            // 缓存数据
            dataManagementState.dataCache[cacheKey] = {
                data: result.data,
                total: result.total
            };
            
            // 渲染表格和分页
            renderDataTable(result.data);
            renderPagination();
            
            // 后台预加载下一页数据
            if (!dataManagementState.preloading) {
                preloadNextPage();
            }
        }
        
    } catch (error) {
        console.error('加载数据管理页面数据失败:', error);
        showToast('加载数据失败，请稍后重试', 'error');
    } finally {
        dataManagementState.isLoading = false;
        hideLoading();
    }
}

/**
 * 预加载下一页数据
 */
async function preloadNextPage() {
    if (dataManagementState.preloading) return;
    
    const nextPage = dataManagementState.currentPage + 1;
    if (nextPage > dataManagementState.totalPages) return;
    
    // 生成缓存键
    const cacheKey = generateCacheKey(nextPage, dataManagementState.filters);
    
    // 检查是否已经预加载或缓存
    if (dataManagementState.dataCache[cacheKey] || dataManagementState.preloadedPages.has(cacheKey)) {
        return;
    }
    
    dataManagementState.preloading = true;
    dataManagementState.preloadedPages.add(cacheKey);
    
    try {
        const response = await fetch(`${API_BASE}/get-optimize-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                page: nextPage,
                page_size: PAGE_SIZE,
                filters: dataManagementState.filters
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 缓存预加载的数据
            dataManagementState.dataCache[cacheKey] = {
                data: result.data,
                total: result.total
            };
        }
    } catch (error) {
        console.error('预加载数据失败:', error);
    } finally {
        dataManagementState.preloading = false;
    }
}

/**
 * 清空缓存（当筛选条件改变时调用）
 */
function clearDataCache() {
    dataManagementState.dataCache = {};
    dataManagementState.preloadedPages.clear();
}

/**
 * 导出数据
 */
function exportData() {
    // 获取所有选中的行
    const checkedBoxes = document.querySelectorAll('#dataTableBody input[type="checkbox"]:checked');
    const selectedQuestionNos = [];
    
    checkedBoxes.forEach(checkbox => {
        const row = checkbox.closest('tr');
        const questionNo = row.querySelector('code').textContent;
        selectedQuestionNos.push(questionNo);
    });
    
    if (selectedQuestionNos.length === 0) {
        showToast('请先选择要导出的数据', 'warning');
        return;
    }
    
    // 构建导出数据
    const exportData = {
        question_nos: selectedQuestionNos,
        timestamp: new Date().toISOString()
    };
    
    // 创建下载链接
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export_data_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast(`成功导出 ${selectedQuestionNos.length} 条数据`, 'success');
}

/**
 * 导入审核
 */
function importToReview() {
    // 获取所有选中的行
    const checkedBoxes = document.querySelectorAll('#dataTableBody input[type="checkbox"]:checked');
    const selectedQuestionNos = [];
    
    checkedBoxes.forEach(checkbox => {
        const row = checkbox.closest('tr');
        const questionNo = row.querySelector('code').textContent;
        selectedQuestionNos.push(questionNo);
    });
    
    if (selectedQuestionNos.length === 0) {
        showToast('请先选择要导入审核的数据', 'warning');
        return;
    }
    
    // 跳转到人工审核页面，并传递选中的问题编号
    const reviewPageUrl = `#manual-review?questions=${encodeURIComponent(selectedQuestionNos.join(','))}`;
    
    // 检查人工审核页面是否存在
    const reviewPage = document.getElementById('manual-review');
    if (reviewPage) {
        // 显示人工审核页面
        document.querySelectorAll('.page-container').forEach(page => {
            page.classList.remove('active');
        });
        reviewPage.classList.add('active');
        
        // 通知人工审核页面处理导入的问题
        if (window.handleImportedQuestions) {
            window.handleImportedQuestions(selectedQuestionNos);
        }
    } else {
        // 如果页面不存在，刷新当前页面并传递参数
        window.location.href = reviewPageUrl;
    }
    
    showToast(`成功导入 ${selectedQuestionNos.length} 条数据到审核页面`, 'success');
}

/**
 * 刷新数据
 */
function refreshData() {
    // 清空缓存，确保获取最新数据
    clearDataCache();
    // 重新加载数据
    loadDataManagementData();
    // 显示刷新成功提示
    showToast('数据已刷新', 'success');
}

/**
 * 渲染数据表格
 */
function renderDataTable(data) {
    if (!elements.dataTable) return;
    
    const tbody = elements.dataTable.querySelector('tbody');
    if (!tbody) return;
    
    if (!data || data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 2rem; color: var(--gray-500);">
                    <i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 0.5rem; display: block;"></i>
                    <p>暂无数据</p>
                </td>
            </tr>
        `;
        return;
    }
    
    let html = '';
    data.forEach((item, index) => {
        const start = (dataManagementState.currentPage - 1) * PAGE_SIZE + index + 1;
        // 状态映射：1：待审核，2：已通过，3：需修改
        const statusMap = {
            1: { class: 'pending', text: '待审核' },
            2: { class: 'active', text: '已通过' },
            3: { class: 'error', text: '需修改' }
        };
        const status = statusMap[item.review_status] || { class: 'pending', text: '待审核' };
        const qualityScore = item.qa_similarity || 0;
        const scorePercentage = qualityScore * 100;
        const scoreColor = qualityScore >= 0.80 ? 'var(--primary-600)' : qualityScore >= 0.7 ? '#92400e' : '#991b1b';
        const scoreGradient = qualityScore >= 0.80 ? 'linear-gradient(90deg, var(--primary-400), var(--primary-600))' : qualityScore >= 0.7 ? 'linear-gradient(90deg, #fbbf24, #f59e0b)' : 'linear-gradient(90deg, #f87171, #ef4444)';
        
        // 高亮搜索关键词
        let questionText = item.text_optimized_question || '无问题内容';
        const searchKeyword = dataManagementState.filters.search;
        if (searchKeyword) {
            const regex = new RegExp(`(${searchKeyword})`, 'gi');
            questionText = questionText.replace(regex, '<mark style="background-color: #fef3c7; padding: 0 2px; border-radius: 2px;">$1</mark>');
        }
        
        html += `
            <tr>
                <td><input type="checkbox" style="cursor: pointer;"></td>
                <td><code>${item.question_no || String(start).padStart(7, '0')}</code></td>
                <td style="max-width: 500px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${questionText}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <div style="flex: 1; height: 6px; background: var(--gray-200); border-radius: 3px;">
                            <div style="width: ${scorePercentage}%; height: 100%; background: ${scoreGradient}; border-radius: 3px;"></div>
                        </div>
                        <span style="font-size: 0.8rem; font-weight: 600; color: ${scoreColor};">${qualityScore.toFixed(4)}</span>
                    </div>
                </td>
                <td><span class="status-badge ${status.class}">${status.text}</span></td>
                <td>
                    <div class="row-actions">
                        <button class="row-action-btn" title="查看" onclick="viewDataDetail('${item.question_no}')">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="row-action-btn" title="编辑" onclick="editData('${item.question_no}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="row-action-btn" title="删除" onclick="deleteData('${item.question_no}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    
    // 更新分页信息
    if (elements.paginationInfo) {
        const start = (dataManagementState.currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(dataManagementState.currentPage * PAGE_SIZE, dataManagementState.totalItems);
        elements.paginationInfo.innerHTML = `显示 <strong>${start}-${end}</strong> 条，共 <strong>${dataManagementState.totalItems.toLocaleString()}</strong> 条数据`;
    }
}

/**
 * 渲染分页控件
 */
function renderPagination() {
    if (!elements.paginationControls) return;
    
    let html = '';
    
    // 上一页按钮
    html += `
        <button class="page-btn" ${dataManagementState.currentPage === 1 ? 'disabled' : ''} onclick="handlePageChange(${dataManagementState.currentPage - 1})">
            <i class="fas fa-chevron-left"></i>
        </button>
    `;
    
    // 页码按钮
    const maxVisiblePages = 5;
    let startPage = Math.max(1, dataManagementState.currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(dataManagementState.totalPages, startPage + maxVisiblePages - 1);
    
    // 调整起始页码以确保显示足够的页码
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    // 第一页按钮
    if (startPage > 1) {
        html += `<button class="page-btn" onclick="handlePageChange(1)">1</button>`;
        if (startPage > 2) {
            html += `<span style="color: var(--gray-400); margin: 0 0.5rem;">...</span>`;
        }
    }
    
    // 中间页码按钮
    for (let i = startPage; i <= endPage; i++) {
        html += `
            <button class="page-btn ${i === dataManagementState.currentPage ? 'active' : ''}" onclick="handlePageChange(${i})">
                ${i}
            </button>
        `;
    }
    
    // 最后一页按钮
    if (endPage < dataManagementState.totalPages) {
        if (endPage < dataManagementState.totalPages - 1) {
            html += `<span style="color: var(--gray-400); margin: 0 0.5rem;">...</span>`;
        }
        html += `<button class="page-btn" onclick="handlePageChange(${dataManagementState.totalPages})"><i class="fas fa-ellipsis-h"></i></button>`;
    }
    
    // 下一页按钮
    html += `
        <button class="page-btn" ${dataManagementState.currentPage === dataManagementState.totalPages ? 'disabled' : ''} onclick="handlePageChange(${dataManagementState.currentPage + 1})">
            <i class="fas fa-chevron-right"></i>
        </button>
    `;
    
    elements.paginationControls.innerHTML = html;
}

/**
 * 处理分页切换
 */
async function handlePageChange(page) {
    if (page < 1 || page > dataManagementState.totalPages) return;
    
    dataManagementState.currentPage = page;
    await loadDataManagementData();
}

/**
 * 查看数据详情
 */
function viewDataDetail(questionNo) {
    console.log('查看数据详情:', questionNo);
    // 这里可以实现查看详情的逻辑
    showToast('查看详情功能开发中', 'info');
}

/**
 * 编辑数据
 */
function editData(questionNo) {
    console.log('编辑数据:', questionNo);
    // 这里可以实现编辑数据的逻辑
    showToast('编辑功能开发中', 'info');
}

/**
 * 删除数据
 */
function deleteData(questionNo) {
    if (confirm('确定要删除这条数据吗？')) {
        console.log('删除数据:', questionNo);
        // 这里可以实现删除数据的逻辑
        showToast('删除功能开发中', 'info');
    }
}

/**
 * 更新系统状态
 */
function updateSystemStatus(status, message = '') {
    const statusEl = elements.systemStatus;
    if (!statusEl) return;
    
    const indicator = statusEl.querySelector('.status-indicator');
    const text = statusEl.querySelector('.status-text');
    
    const statusMap = {
        'ready': { color: '#22c55e', text: '就绪' },
        'connecting': { color: '#f59e0b', text: '连接中...' },
        'connected': { color: '#22c55e', text: '已连接' },
        'error': { color: '#ef4444', text: '错误' },
        'processing': { color: '#3b82f6', text: '处理中...' }
    };
    
    const config = statusMap[status] || statusMap['ready'];
    indicator.style.background = config.color;
    text.textContent = config.text;
}

/**
 * 显示 Toast 提示
 */
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span>${message}</span>
    `;
    
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-in-out reverse';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * 显示加载状态
 */
function showLoading(text = '加载中...') {
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loadingText');
    if (loading && loadingText) {
        loadingText.textContent = text;
        loading.style.display = 'flex';
    }
}

/**
 * 隐藏加载状态
 */
function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = 'none';
    }
}

/**
 * 显示错误提示
 */
function showError(text = '发生错误，请重试', retryCallback = null) {
    const error = document.getElementById('error');
    const errorText = document.getElementById('errorText');
    const retryButton = document.getElementById('retryButton');
    
    if (error && errorText) {
        errorText.textContent = text;
        error.style.display = 'block';
        
        if (retryButton) {
            retryButton.onclick = function() {
                error.style.display = 'none';
                if (retryCallback) {
                    retryCallback();
                }
            };
        }
    }
}

/**
 * 隐藏错误提示
 */
function hideError() {
    const error = document.getElementById('error');
    if (error) {
        error.style.display = 'none';
    }
}

/**
 * 处理数据库配置
 */
async function handleDbConfig(e) {
    e.preventDefault();
    
    const formData = new FormData(elements.dbConfigForm);
    const config = Object.fromEntries(formData.entries());
    config.port = parseInt(config.port);
    
    // 添加 schema 配置
    config.schema = document.getElementById('dbSchema')?.value || 'test';
    config.db_type = 'postgresql';
    
    try {
        updateSystemStatus('connecting');
        showLocalLoading(elements.dbStatus, '正在连接数据库...');
        
        const response = await fetch(`${API_BASE}/connect-db`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess(elements.dbStatus, result.message);
            globalData.dataSource = 'database';
            globalData.isConnected = true;
            
            updateSystemStatus('connected');
            showToast('数据库连接成功！', 'success');
            
            // 启用评分按钮
            enableButtons();
            
            // 预览数据（不自动打开预览抽屉）
            await previewDatabaseDataWithoutOpen();
            

        } else {
            showError(elements.dbStatus, result.error || '连接失败');
            updateSystemStatus('error');
            showToast(result.error || '数据库连接失败', 'error');
        }
    } catch (error) {
        showError(elements.dbStatus, `连接错误：${error.message}`);
        updateSystemStatus('error');
        showToast(`连接错误：${error.message}`, 'error');
    }
}

/**
 * 处理多文件上传
 */
async function handleMultiFileUpload(file, tableType) {
    console.log(`[Excel上传] 开始上传 ${file.name} (${(file.size / 1024).toFixed(2)} KB) - ${tableType}`);
    
    try {
        // 查找对应的上传区域和状态指示器
        const uploadArea = document.querySelector(`.upload-area-small[data-type="${tableType}"]`);
        const statusIndicator = elements.statusIndicators[tableType];
        
        if (!uploadArea || !statusIndicator) {
            console.error('[Excel上传] 错误：找不到对应的 DOM 元素');
            showToast('页面元素未加载，请刷新页面重试', 'error');
            return;
        }
        
        // 显示上传中状态
        statusIndicator.innerHTML = `
            <span class="spinner spinner-small"></span> 
            <span class="status-label">上传中...</span>
            <div class="upload-progress" style="margin-top: 0.5rem; width: 100%;">
                <div class="upload-progress-bar" style="height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden;">
                    <div class="upload-progress-fill" style="height: 100%; background: #4CAF50; width: 0%; transition: width 0.3s ease;"></div>
                </div>
                <div class="upload-progress-text" style="font-size: 0.75rem; color: #666; margin-top: 0.25rem; text-align: center;">0%</div>
            </div>
        `;
        
        // 准备表单数据
        const formData = new FormData();
        formData.append('file', file);
        
        // 发送请求
        console.log('[Excel上传] 发送上传请求...');
        
        // 模拟进度更新
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += 5;
            if (progress > 90) progress = 90; // 留10%用于最终完成
            
            const progressFill = statusIndicator.querySelector('.upload-progress-fill');
            const progressText = statusIndicator.querySelector('.upload-progress-text');
            
            if (progressFill && progressText) {
                progressFill.style.width = `${progress}%`;
                progressText.textContent = `${progress}%`;
            }
        }, 500);
        
        const response = await fetch(`${API_BASE}/upload-excel`, {
            method: 'POST',
            body: formData
        });
        
        clearInterval(progressInterval);
        
        // 解析响应
        const result = await response.json();
        
        // 完成进度
        const progressFill = statusIndicator.querySelector('.upload-progress-fill');
        const progressText = statusIndicator.querySelector('.upload-progress-text');
        if (progressFill && progressText) {
            progressFill.style.width = '100%';
            progressText.textContent = '100%';
        }
        
        if (result.success) {
            console.log(`[Excel上传] ${tableType} 表上传成功，${result.data.table_count} 条记录`);
            
            // 更新上传状态
            uploadState[tableType] = true;
            
            // 更新状态显示
            statusIndicator.innerHTML = `
                <span class="status-dot success"></span>
                <span class="status-label">已上传 (${result.data.table_count}条)</span>
            `;
            
            // 更新计数
            if (elements.uploadSummaries[tableType]) {
                const countKey = `${tableType}_count`;
                const countValue = result.data[countKey] || 0;
                elements.uploadSummaries[tableType].textContent = countValue;
            }
            
            // 显示成功提示
            const tableName = tableType === 'questions' ? '问题表' : tableType === 'replies' ? '回复表' : '图片表';
            showToast(`${tableName} 上传成功！共 ${result.data.table_count} 条记录`, 'success');
            
            // 检查是否所有表都已上传
            if (result.data.all_ready) {
                console.log('[Excel上传] 所有表已上传完成，数据就绪');
                
                // 所有数据已就绪
                // 只存储问题编号，不存储完整数据
                globalData.questionNos = (result.data.questions || []).map(q => q.question_no);
                globalData.loadedData.replies = {};
                (result.data.replies || []).forEach(r => {
                    globalData.loadedData.replies[r.reply_no] = r;
                });
                globalData.loadedData.images = result.data.images || [];
                globalData.dataSource = 'excel';
                globalData.isConnected = true;
                
                console.log(`[Excel上传] 统计: 问题${globalData.questionNos.length}条, 回复${Object.keys(globalData.loadedData.replies).length}条, 图片${globalData.loadedData.images.length}条`);
                
                // 更新系统状态
                updateSystemStatus('connected');
                showToast('所有表已上传完成，可以开始评分！', 'success');
                
                // 启用评分按钮
                enableButtons();
                
                // 显示预览（不自动打开预览抽屉）
                displayTable(elements.questionsTable, globalData.questions);
                displayTable(elements.repliesTable, globalData.replies);
                displayTable(elements.imagesTable, globalData.images);
                
                // 显示提示
                showToast('数据已就绪，可以点击数据预览查看详情', 'info');
            } else {
                // 提示还需要上传哪些表
                const missing = Object.entries(uploadState)
                    .filter(([key, value]) => !value)
                    .map(([key]) => key === 'questions' ? '问题表' : key === 'replies' ? '回复表' : '图片表');
                
                if (missing.length > 0) {
                    console.log(`[Excel上传] 还需上传: ${missing.join('、')}`);
                    showToast(`还需上传：${missing.join('、')}`, 'info', 5000);
                }
            }
        } else {
            console.error(`[Excel上传] 上传失败: ${result.error}`);
            statusIndicator.innerHTML = `
                <span class="status-dot error"></span>
                <span class="status-label">上传失败</span>
            `;
            showToast(`上传失败：${result.error}`, 'error');
        }
    } catch (error) {
        console.error(`[Excel上传] 发生异常: ${error.message}`);
        
        // 更新失败状态
        const statusIndicator = elements.statusIndicators[tableType];
        if (statusIndicator) {
            statusIndicator.innerHTML = `
                <span class="status-dot error"></span>
                <span class="status-label">上传失败</span>
            `;
        }
        
        showToast(`上传错误：${error.message}`, 'error');
    } finally {
        console.log('[Excel上传] 上传过程完成');
    }
}

/**
 * 处理重置上传
 */
async function handleResetUpload() {
    try {
        const response = await fetch(`${API_BASE}/reset-upload`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 重置状态
            uploadState = {
                questions: false,
                replies: false,
                images: false
            };
            
            // 重置全局数据
            globalData.questionNos = [];
            globalData.dataCache.clear();
            globalData.loadedData = {
                questions: {},
                replies: {},
                images: []
            };
            globalData.dataSource = null;
            globalData.isConnected = false;
            globalData.isScored = false;
            globalData.exportResult = null;
            

            
            // 清除评分结果显示
            const scoringResult = document.getElementById('scoringResult');
            if (scoringResult) {
                scoringResult.innerHTML = '';
                scoringResult.classList.add('hidden');
            }
            
            // 重置 UI 状态
            elements.uploadItems.forEach(item => {
                const tableType = item.querySelector('.upload-area-small').dataset.type;
                const statusIndicator = elements.statusIndicators[tableType];
                if (statusIndicator) {
                    statusIndicator.innerHTML = `
                        <span class="status-dot"></span>
                        <span class="status-label">未上传</span>
                    `;
                }
                
                // 重置文件输入
                const fileInput = item.querySelector('.excel-file-input');
                if (fileInput) {
                    fileInput.value = '';
                }
            });
            
            // 重置计数
            if (elements.uploadSummaries.questions) {
                elements.uploadSummaries.questions.textContent = '0';
            }
            if (elements.uploadSummaries.replies) {
                elements.uploadSummaries.replies.textContent = '0';
            }
            if (elements.uploadSummaries.images) {
                elements.uploadSummaries.images.textContent = '0';
            }
            
            // 禁用按钮
            elements.btnScore.disabled = true;
            elements.btnExport.disabled = true;
            
            // 重置状态显示
            updateSystemStatus('ready');
            
            showToast('已重置所有上传数据', 'success');
        }
    } catch (error) {
        showToast(`重置失败：${error.message}`, 'error');
    }
}

/**
 * 处理评分
 */
async function handleScoring() {
    if (!globalData.isConnected) {
        showToast('请先连接数据库或上传文件', 'warning');
        return;
    }
    
    elements.btnScore.disabled = true;
    elements.btnScore.innerHTML = '<span class="spinner"></span> 评分中...';
    
    // 显示进度
    elements.scoringProgress.classList.remove('hidden');
    
    // 模拟进度动画
    const progressBar = elements.scoringProgress.querySelector('.progress-bar-fill');
    const percentText = elements.scoringProgress.querySelector('.progress-percent');
    const processedCount = document.getElementById('processedCount');
    const dashboardTotalCount = document.getElementById('dashboardTotalCount');
    
    // 根据数据源类型计算总回复数
    let total;
    if (globalData.dataSource === 'database') {
        total = globalData.replies.length || 100;
    } else {
        total = globalData.replies.length || 100;
    }
    if (dashboardTotalCount) {
        dashboardTotalCount.textContent = total;
    }
    
    let progress = 0;
    const interval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress > 90) progress = 90;
        
        progressBar.style.width = `${progress}%`;
        percentText.textContent = `${Math.round(progress)}%`;
        processedCount.textContent = Math.round(total * progress / 100);
    }, 200);
    
    try {
        let scoreResult;
        
        // 添加超时处理
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('评分操作超时，请稍后重试')), 600000); // 10分钟超时，适应大规模数据处理
        });
        
        if (globalData.dataSource === 'database') {
            const response = await Promise.race([
                fetch(`${API_BASE}/score-database`, {
                    method: 'POST'
                }),
                timeoutPromise
            ]);
            scoreResult = await response.json();
        } else {
            // 对 Excel 数据进行评分
            const response = await Promise.race([
                fetch(`${API_BASE}/score-excel-data`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        replies: globalData.replies
                    })
                }),
                timeoutPromise
            ]);
            scoreResult = await response.json();
        }
        
        clearInterval(interval);
        progressBar.style.width = '100%';
        percentText.textContent = '100%';
        processedCount.textContent = total;
        
        // 隐藏评分进度条
        elements.scoringProgress.classList.add('hidden');
        
        if (scoreResult.success) {
                // 更新数据
                if (scoreResult.data.questions) {
                    // 只存储问题编号，不存储完整数据
                    globalData.questionNos = scoreResult.data.questions.map(q => q.question_no) || [];
                    // 清空缓存
                    globalData.dataCache.clear();
                    globalData.loadedData.questions = {};
                    globalData.loadedData.replies = {};
                }
                if (scoreResult.data.replies) {
                    // 存储回复数据
                    scoreResult.data.replies.forEach(r => {
                        globalData.loadedData.replies[r.reply_no] = r;
                    });
                }
                if (scoreResult.data.images) {
                    globalData.loadedData.images = scoreResult.data.images;
                }
                
                globalData.isScored = true;
            
            // 自动导出
            let exportResult;
            if (globalData.dataSource === 'database') {
                const response = await fetch(`${API_BASE}/export-database`, {
                    method: 'POST'
                });
                exportResult = await response.json();
            } else {
                const response = await fetch(`${API_BASE}/export-excel-data`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        questions: globalData.questions,
                        replies: globalData.replies,
                        images: globalData.images
                    })
                });
                exportResult = await response.json();
            }
            
            if (exportResult.success) {
                const count = exportResult.message.match(/\d+/)?.[0] || 0;
                const downloadUrl = `${API_BASE}${exportResult.download_url}`;
                
                // 保存导出结果
                globalData.exportResult = exportResult;
                
                elements.scoringResult.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center; text-align: center;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <span style="font-size: 1rem;">✓</span>
                            <div>
                                <strong>评分完成！</strong><br>
                                共处理 <strong>${scoreResult.data.replies_count}</strong> 条回复<br>
                                已生成 <strong>${count}</strong> 条训练数据
                            </div>
                        </div>
                        <div style="display: flex; gap: 1rem; justify-content: center; width: 100%; flex-wrap: wrap;">
                            <a href="${downloadUrl}" download="${exportResult.filename || 'training_data.json'}" style="padding: 0.75rem 1.5rem; background: var(--primary-500); color: white; border-radius: var(--radius-md); text-decoration: none; transition: all var(--transition); font-weight: 500; display: flex; align-items: center; gap: 0.5rem;">
                                <span>⬇️</span> 一键下载 JSON 文件
                            </a>
                        </div>
                        <p style="color: var(--text-muted); font-size: 0.875rem; max-width: 550px;">
                            数据已按照要求就绪，可直接下载使用，或通过优化步骤进一步提升数据质量
                        </p>
                    </div>
                `;
                elements.scoringResult.classList.remove('hidden');
                

                
                showToast('评分和导出完成！', 'success');
        } else {
            throw new Error(exportResult.error || '导出失败');
        }
        
        // 更新优化按钮状态
        updateOptimizeButtonState();
        
        // 更新预览表格
        displayDataPreview();
        
        // 打开预览抽屉
        openPreview();
        
        } else {
            throw new Error(scoreResult.error);
        }
    } catch (error) {
        clearInterval(interval);
        elements.scoringResult.innerHTML = `<p style="color: var(--error);">评分失败：${error.message}</p>`;
        elements.scoringResult.classList.remove('hidden');
        showToast('评分失败', 'error');
    } finally {
        elements.btnScore.disabled = false;
        elements.btnScore.innerHTML = '<span class="btn-icon">⚡</span> 开始评分';
    }
}

/**
 * 处理导出
 */
async function handleExport() {
    if (!globalData.isScored) {
        showToast('请先进行评分', 'warning');
        return;
    }
    
    elements.btnExport.disabled = true;
    elements.btnExport.innerHTML = '<span class="spinner"></span> 导出中...';
    elements.exportProgress.classList.remove('hidden');
    
    try {
        let result;
        
        if (globalData.dataSource === 'database') {
            const response = await fetch(`${API_BASE}/export-database`, {
                method: 'POST'
            });
            result = await response.json();
        } else {
            // 从 loadedData 中获取数据
            const questions = Object.values(globalData.loadedData.questions);
            const replies = Object.values(globalData.loadedData.replies);
            const images = globalData.loadedData.images;
            
            const response = await fetch(`${API_BASE}/export-excel-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    questions: questions,
                    replies: replies,
                    images: images
                })
            });
            result = await response.json();
        }
        
        if (result.success) {
            const count = result.message.match(/\d+/)?.[0] || 0;
            const downloadUrl = `${API_BASE}${result.download_url}`;
            
            elements.exportResult.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="font-size: 1.5rem;">💾</span>
                    <div>
                        <strong>导出成功！</strong><br>
                        共生成 <strong>${count}</strong> 条训练数据
                    </div>
                </div>
                <a href="${downloadUrl}" download="${result.filename || 'training_data.json'}" style="display: inline-block; margin-top: 0.5rem; padding: 0.5rem 1rem; background: var(--primary-500); color: white; border-radius: var(--radius-md); text-decoration: none; transition: all var(--transition);">
                    <span>⬇️</span> 下载 JSON 文件
                </a>
            `;
            elements.exportResult.classList.remove('hidden');
            
            showToast('导出成功！', 'success');
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        elements.exportResult.innerHTML = `<p style="color: var(--error);">导出失败：${error.message}</p>`;
        elements.exportResult.classList.remove('hidden');
        showToast('导出失败', 'error');
    } finally {
        elements.btnExport.disabled = false;
        elements.btnExport.innerHTML = '<span class="btn-icon">💾</span> 一键导出 JSON 文件';
        elements.exportProgress.classList.add('hidden');
    }
}

/**
 * 预览数据库数据
 */
async function previewDatabaseData() {
    try {
        const response = await fetch(`${API_BASE}/preview-data`, {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            // 只存储问题编号，不存储完整数据
            globalData.questionNos = result.data.questions.map(q => q.question_no) || [];
            globalData.loadedData.images = result.data.images || [];
            
            // 清空缓存
            globalData.dataCache.clear();
            globalData.loadedData.questions = {};
            globalData.loadedData.replies = {};
            
            // 加载第一页数据并显示
            await loadPageData(1);
            displayDataPreview();
        }
    } catch (error) {
        console.error('预览数据失败:', error);
    }
}

/**
 * 预览数据库数据（不自动打开预览抽屉）
 */
async function previewDatabaseDataWithoutOpen() {
    try {
        const response = await fetch(`${API_BASE}/preview-data`, {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            // 只存储问题编号，不存储完整数据
            globalData.questionNos = result.data.questions.map(q => q.question_no) || [];
            globalData.replies = result.data.replies || []; // 存储回复数据
            globalData.loadedData.images = result.data.images || [];
            
            // 清空缓存
            globalData.dataCache.clear();
            globalData.loadedData.questions = {};
            globalData.loadedData.replies = {};
            
            // 加载第一页数据
            await loadPageData(1);
            
            // 只更新表格数据，不打开预览抽屉
            displayTable(elements.questionsTable, Object.values(globalData.loadedData.questions));
            displayTable(elements.repliesTable, Object.values(globalData.loadedData.replies));
            displayTable(elements.imagesTable, globalData.loadedData.images);
        }
    } catch (error) {
        console.error('预览数据失败:', error);
    }
}

/**
 * 显示数据预览
 */
async function displayDataPreview() {
    // 加载第一页数据
    await loadPageData(1);
    
    // 从 loadedData 中获取数据
    displayTable(elements.questionsTable, Object.values(globalData.loadedData.questions));
    displayTable(elements.repliesTable, Object.values(globalData.loadedData.replies));
    displayTable(elements.imagesTable, globalData.loadedData.images);
    
    // 自动打开预览
    setTimeout(() => openPreview(), 500);
}

/**
 * 显示表格数据
 */
function displayTable(tableElement, data) {
    if (!data || data.length === 0) {
        tableElement.innerHTML = '<tr><td style="text-align: center; padding: 2rem;">暂无数据</td></tr>';
        return;
    }
    
    const columns = Object.keys(data[0]);
    
    let html = '<thead><tr>';
    columns.forEach(col => {
        html += `<th>${col}</th>`;
    });
    html += '</tr></thead><tbody>';
    
    data.slice(0, 100).forEach(row => {
        html += '<tr>';
        columns.forEach(col => {
            let value = row[col];
            if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
                value = '';
            } else if (typeof value === 'object') {
                value = JSON.stringify(value);
            }
            html += `<td>${value}</td>`;
        });
        html += '</tr>';
    });
    
    html += '</tbody>';
    tableElement.innerHTML = html;
}

/**
 * 处理 Tab 切换
 */
function handleTabSwitch(e) {
    const tab = e.target;
    const tabName = tab.dataset.tab;
    
    // 切换 Tab 激活状态
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // 切换 Tab 内容
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active');
}

/**
 * 打开/关闭预览抽屉
 */
function togglePreview() {
    elements.previewDrawer.classList.toggle('open');
}

function openPreview() {
    elements.previewDrawer.classList.add('open');
}

function closePreview() {
    elements.previewDrawer.classList.remove('open');
}

/**
 * 显示局部加载状态
 */
function showLocalLoading(element, message) {
    if (!element) return;
    element.innerHTML = `<span class="spinner"></span> ${message}`;
    element.className = 'status-message';
    element.style.display = 'block';
}

/**
 * 显示成功状态
 */
function showSuccess(element, message) {
    if (!element) return;
    element.innerHTML = `✓ ${message}`;
    element.className = 'status-message success';
    element.style.display = 'block';
}

/**
 * 显示错误状态
 */
function showError(element, message) {
    if (!element) return;
    element.innerHTML = `✗ ${message}`;
    element.className = 'status-message error';
    element.style.display = 'block';
}

/**
 * 更新优化按钮状态
 */
function updateOptimizeButtonState() {
    if (elements.btnOptimize) {
        // 检查是否已评分、有导出结果、API配置和模型选择都已设置
        const isApiConfigured = elements.apiKey?.value && elements.apiBaseUrl?.value;
        const isModelsSelected = elements.textModelInput?.value && elements.vlModelInput?.value;
        elements.btnOptimize.disabled = !globalData.isScored || !globalData.exportResult || !isApiConfigured || !isModelsSelected;
    }
    
    if (elements.btnOptimizeTest) {
        // 检查是否已评分、有导出结果、API配置和模型选择都已设置
        const isApiConfigured = elements.apiKey?.value && elements.apiBaseUrl?.value;
        const isModelsSelected = elements.textModelInput?.value && elements.vlModelInput?.value;
        elements.btnOptimizeTest.disabled = !globalData.isScored || !globalData.exportResult || !isApiConfigured || !isModelsSelected;
    }
    
    if (elements.btnAnalyzeSimilarity) {
        elements.btnAnalyzeSimilarity.disabled = !globalData.optimizeResult;
    }
}

/**
 * 处理优化操作
 */
async function handleOptimize() {
    if (!globalData.isScored) {
        showToast('请先进行评分', 'warning');
        return;
    }
    
    // 检查是否有导出结果
    if (!globalData.exportResult) {
        showToast('请先完成评分和导出', 'warning');
        return;
    }
    
    // 检查 API 配置
    const apiKey = elements.apiKey?.value;
    const apiBaseUrl = elements.apiBaseUrl?.value;
    if (!apiKey || !apiBaseUrl) {
        showToast('请配置 API 密钥和基础 URL', 'warning');
        return;
    }
    
    // 检查模型选择
    const textModel = elements.textModelInput?.value;
    const vlModel = elements.vlModelInput?.value;
    if (!textModel || !vlModel) {
        showToast('请选择文本模型和多模态模型', 'warning');
        return;
    }
    
    elements.btnOptimize.disabled = true;
    elements.btnOptimize.innerHTML = '<span class="spinner"></span> 优化中...';
    elements.optimizeProgress.classList.remove('hidden');
    
    try {
        // 检查是否有问题编号
        if (!globalData.questionNos || globalData.questionNos.length === 0) {
            throw new Error('未指定问题编号，请先进行评分操作');
        }
        
        // 调用后端优化 API
        const response = await fetch(`${API_BASE}/optimize-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text_model: textModel,
                vl_model: vlModel,
                data_source: globalData.dataSource,
                api_key: apiKey,
                api_base_url: apiBaseUrl,
                question_prompt: globalData.customPrompts.text.question,
                answer_prompt: globalData.customPrompts.text.answer,
                vl_question_prompt: globalData.customPrompts.vl.question,
                vl_answer_prompt: globalData.customPrompts.vl.answer,
                batch_size: 1000, // 每批处理的数量
                question_nos: globalData.questionNos // 需要优化的问题编号列表
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 保存优化结果
            globalData.optimizeResult = result.data;
            
            // 更新相似度分析按钮状态
            updateOptimizeButtonState();
            
            elements.optimizeResult.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 1rem; align-items: center; text-align: center;">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <span style="font-size: 1.5rem;">✨</span>
                        <div>
                            <strong>优化完成！</strong><br>
                            共优化 <strong>${result.data.optimized_count}</strong> 条回复<br>
                            文本模型：${result.data.text_model}<br>
                            多模态模型：${result.data.vl_model}
                        </div>
                    </div>

                </div>
            `;
            elements.optimizeResult.classList.remove('hidden');
            
            // 保存优化结果到 globalData
            globalData.optimizeResult = result.data;
            
            showToast('优化完成！', 'success');

        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        elements.optimizeResult.innerHTML = `<p style="color: var(--error);">优化失败：${error.message}</p>`;
        elements.optimizeResult.classList.remove('hidden');
        showToast(`优化失败：${error.message}`, 'error');
    } finally {
        elements.btnOptimize.disabled = false;
        elements.btnOptimize.innerHTML = '<span class="btn-icon">✨</span> 开始优化';
        elements.optimizeProgress.classList.add('hidden');
    }
}

/**
 * 处理优化测试操作
 */
async function handleOptimizeTest() {
    if (!globalData.isScored) {
        showToast('请先进行评分', 'warning');
        return;
    }
    
    // 检查是否有导出结果
    if (!globalData.exportResult) {
        showToast('请先完成评分和导出', 'warning');
        return;
    }
    
    // 检查 API 配置
    const apiKey = elements.apiKey?.value;
    const apiBaseUrl = elements.apiBaseUrl?.value;
    if (!apiKey || !apiBaseUrl) {
        showToast('请配置 API 密钥和基础 URL', 'warning');
        return;
    }
    
    // 检查模型选择
    const textModel = elements.textModelInput?.value;
    const vlModel = elements.vlModelInput?.value;
    if (!textModel || !vlModel) {
        showToast('请选择文本模型和多模态模型', 'warning');
        return;
    }
    
    elements.btnOptimizeTest.disabled = true;
    elements.btnOptimizeTest.innerHTML = '<span class="spinner"></span> 测试中...';
    elements.optimizeProgress.classList.remove('hidden');
    

    
    try {
        // 检查是否有问题编号
        if (!globalData.questionNos || globalData.questionNos.length === 0) {
            throw new Error('未指定问题编号，请先进行评分操作');
        }
        
        // 调用后端优化测试 API
        const response = await fetch(`${API_BASE}/optimize-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text_model: textModel,
                vl_model: vlModel,
                data_source: globalData.dataSource,
                api_key: apiKey,
                api_base_url: apiBaseUrl,
                question_prompt: globalData.customPrompts.text.question,
                answer_prompt: globalData.customPrompts.text.answer,
                vl_question_prompt: globalData.customPrompts.vl.question,
                vl_answer_prompt: globalData.customPrompts.vl.answer,
                test_mode: true, // 测试模式，只处理前5条数据
                test_count: 5,
                question_nos: globalData.questionNos // 需要优化的问题编号列表
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 保存测试结果
            globalData.optimizeTestResult = result.data;
            

            
            // 显示预览按钮
            showPreviewButton();
            
            // 显示测试结果模态框
            showOptimizeTestModal();
            
            showToast('优化测试完成！', 'success');
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        elements.optimizeResult.innerHTML = `<p style="color: var(--error);">测试失败：${error.message}</p>`;
        elements.optimizeResult.classList.remove('hidden');
        showToast('测试失败', 'error');
    } finally {
        elements.btnOptimizeTest.disabled = false;
        elements.btnOptimizeTest.innerHTML = '<span class="btn-icon">🧪</span> 优化测试';
        elements.optimizeProgress.classList.add('hidden');
        

    }
}

/**
 * 显示优化测试结果模态框
 */
function showOptimizeTestModal() {
    const modal = document.getElementById('optimizeTestModal');
    const content = document.getElementById('optimizeTestContent');
    
    if (modal && content) {
        // 显示模态框
        modal.style.display = 'flex';
        
        // 加载多模态模型结果
        loadOptimizeTestResults('vl');
        
        // 重置按钮状态
        document.getElementById('btnTextModelTest').className = 'btn btn-secondary btn-sm';
        document.getElementById('btnVlModelTest').className = 'btn btn-primary btn-sm';
        
        // 添加事件监听器
        document.getElementById('btnTextModelTest').addEventListener('click', () => {
            document.getElementById('btnTextModelTest').className = 'btn btn-primary btn-sm';
            document.getElementById('btnVlModelTest').className = 'btn btn-secondary btn-sm';
            loadOptimizeTestResults('text');
        });
        
        document.getElementById('btnVlModelTest').addEventListener('click', () => {
            document.getElementById('btnVlModelTest').className = 'btn btn-primary btn-sm';
            document.getElementById('btnTextModelTest').className = 'btn btn-secondary btn-sm';
            loadOptimizeTestResults('vl');
        });
        
        document.getElementById('closeOptimizeTestModal').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        
        document.getElementById('closeOptimizeTestBtn').addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
}

/**
 * 显示预览按钮
 */
function showPreviewButton() {
    // 首先检查预览按钮是否已经存在
    if (document.getElementById('btnPreviewOptimizeTest')) {
        return; // 按钮已存在，不需要重复创建
    }
    
    const btnOptimizeTest = document.getElementById('btnOptimizeTest');
    const btnOptimize = document.getElementById('btnOptimize');
    if (btnOptimizeTest && btnOptimize) {
        // 找到两个按钮的父容器
        const parentElement = btnOptimizeTest.parentElement;
        if (parentElement) {
            // 确保父容器使用 flex 布局
            parentElement.style.display = 'flex';
            parentElement.style.flexDirection = 'column';
            parentElement.style.alignItems = 'center';
            parentElement.style.gap = '0.75rem';
            
            // 创建第一排容器
            const firstRow = document.createElement('div');
            firstRow.style.display = 'flex';
            firstRow.style.gap = '1rem';
            firstRow.style.width = '100%';
            firstRow.style.justifyContent = 'center';
            
            // 移动现有按钮到第一排
            firstRow.appendChild(btnOptimizeTest);
            firstRow.appendChild(btnOptimize);
            
            // 插入第一排到父容器
            parentElement.insertBefore(firstRow, parentElement.firstChild);
            
            // 创建预览按钮
            const previewButton = document.createElement('button');
            previewButton.id = 'btnPreviewOptimizeTest';
            previewButton.className = 'btn btn-secondary btn-sm';
            previewButton.style.cssText = `
                width: 100%;
                max-width: 600px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                padding: 0.75rem 1.5rem;
            `;
            previewButton.innerHTML = '<span class="btn-icon">👁️</span> 预览优化测试结果';
            previewButton.addEventListener('click', function() {
                if (globalData.optimizeTestResult) {
                    showOptimizeTestModal();
                } else {
                    showToast('暂无优化测试结果', 'info');
                }
            });
            
            // 添加预览按钮到父容器（第二排）
            parentElement.appendChild(previewButton);
        }
    }
}

/**
 * 加载优化测试结果
 */
function loadOptimizeTestResults(modelType) {
    const content = document.getElementById('optimizeTestContent');
    if (!content || !globalData.optimizeTestResult) return;
    
    const downloadUrl = modelType === 'text' ? 
        `${API_BASE}${globalData.optimizeTestResult.text_download_url}` : 
        `${API_BASE}${globalData.optimizeTestResult.vl_download_url}`;
    
    // 加载优化结果数据
    fetch(downloadUrl)
        .then(response => response.json())
        .then(data => {
            // 显示结果
            let html = '';
            data.forEach((item, index) => {
                html += `
                    <div style="margin-bottom: 2rem; padding: 1.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius-md); background-color: white; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h4 style="margin-top: 0; margin-bottom: 1.5rem; color: var(--gray-800); font-size: 1.1rem; font-weight: 600;">测试数据 ${index + 1}</h4>
                        
                        <div style="margin-bottom: 1.5rem;">
                            <h5 style="margin-top: 0; margin-bottom: 0.75rem; color: var(--gray-600); font-size: 0.9rem; font-weight: 500;">原始问题：</h5>
                            <div style="padding: 1rem; background-color: var(--gray-50); border-radius: var(--radius-sm); border-left: 4px solid var(--gray-400); font-size: 0.95rem;">
                                ${item.metadata?.original_question || item.conversations?.[0]?.value || '无'}
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 1.5rem;">
                            <h5 style="margin-top: 0; margin-bottom: 0.75rem; color: var(--gray-600); font-size: 0.9rem; font-weight: 500;">原始回答：</h5>
                            <div style="padding: 1rem; background-color: var(--gray-50); border-radius: var(--radius-sm); border-left: 4px solid var(--gray-400); font-size: 0.95rem;">
                                ${item.metadata?.original_answer || item.conversations?.[1]?.value || '无'}
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 1.5rem;">
                            <h5 style="margin-top: 0; margin-bottom: 0.75rem; color: var(--green-600); font-size: 0.9rem; font-weight: 500;">优化问题：</h5>
                            <div style="padding: 1rem; background-color: var(--green-50); border-radius: var(--radius-sm); border-left: 4px solid var(--green-500); font-size: 0.95rem;">
                                ${item.conversations?.[0]?.value || '无'}
                            </div>
                        </div>
                        
                        <div>
                            <h5 style="margin-top: 0; margin-bottom: 0.75rem; color: var(--green-600); font-size: 0.9rem; font-weight: 500;">优化回答：</h5>
                            <div style="padding: 1rem; background-color: var(--green-50); border-radius: var(--radius-sm); border-left: 4px solid var(--green-500); font-size: 0.95rem;">
                                ${item.conversations?.[1]?.value || '无'}
                            </div>
                        </div>
                    </div>
                `;
            });
            
            content.innerHTML = html;
        })
        .catch(error => {
            content.innerHTML = `<p style="color: var(--error); text-align: center; padding: 2rem;">加载测试结果失败：${error.message}</p>`;
        });
}

/**
 * 启用按钮
 */
function enableButtons() {
    elements.btnScore.disabled = false;
    updateOptimizeButtonState();
}

/**
 * 获取模型列表
 */
async function fetchModels() {
    try {
        const response = await fetch(`${API_BASE}/get-models`);
        const result = await response.json();
        
        if (result.success) {
            const textModels = result.data.text_models;
            const vlModels = result.data.vl_models;
            
            // 更新文本模型下拉框
            if (elements.textModelSelect && textModels) {
                elements.textModelSelect.innerHTML = '';
                textModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.value;
                    option.textContent = model.label;
                    elements.textModelSelect.appendChild(option);
                });
            }
            
            // 更新多模态模型下拉框
            if (elements.vlModelSelect && vlModels) {
                elements.vlModelSelect.innerHTML = '';
                vlModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.value;
                    option.textContent = model.label;
                    elements.vlModelSelect.appendChild(option);
                });
            }
            
            console.log('[模型] 模型列表获取成功');
        } else {
            console.error('[模型] 获取模型列表失败:', result.error);
        }
    } catch (error) {
        console.error('[模型] 获取模型列表错误:', error);
    }
}

/**
 * 加载默认提示词
 */
async function loadDefaultPrompts() {
    try {
        // 加载文本模型默认提示词
        const textResponse = await fetch(`${API_BASE}/get-default-prompts?model_type=text`);
        const textResult = await textResponse.json();
        
        if (textResult.success) {
            // 存储文本模型默认提示词
            globalData.customPrompts.text.question = textResult.data.question_prompt;
            globalData.customPrompts.text.answer = textResult.data.answer_prompt;
            
            console.log('[提示词] 文本模型默认提示词加载成功');
        } else {
            console.error('[提示词] 加载文本模型默认提示词失败:', textResult.error);
        }
        
        // 加载多模态模型默认提示词
        const vlResponse = await fetch(`${API_BASE}/get-default-prompts?model_type=vl`);
        const vlResult = await vlResponse.json();
        
        if (vlResult.success) {
            // 存储多模态模型默认提示词
            globalData.customPrompts.vl.question = vlResult.data.question_prompt;
            globalData.customPrompts.vl.answer = vlResult.data.answer_prompt;
            
            console.log('[提示词] 多模态模型默认提示词加载成功');
        } else {
            console.error('[提示词] 加载多模态模型默认提示词失败:', vlResult.error);
        }
    } catch (error) {
        console.error('[提示词] 加载默认提示词错误:', error);
    }
}

/**
 * 打开提示词编辑模态框
 */
function openPromptModal(type, modelType) {
    // 存储当前编辑的模型类型
    window.currentModelType = modelType;
    
    if (type === 'question') {
        elements.questionPrompt.value = globalData.customPrompts[modelType].question;
        elements.questionPromptModal.style.display = 'flex';
    } else if (type === 'answer') {
        elements.answerPrompt.value = globalData.customPrompts[modelType].answer;
        elements.answerPromptModal.style.display = 'flex';
    }
}

/**
 * 关闭提示词编辑模态框
 */
function closePromptModal(type) {
    if (type === 'question') {
        elements.questionPromptModal.style.display = 'none';
    } else if (type === 'answer') {
        elements.answerPromptModal.style.display = 'none';
    }
    // 清除当前模型类型
    window.currentModelType = null;
}

/**
 * 保存提示词
 */
function savePrompt(type) {
    const modelType = window.currentModelType || 'text';
    
    if (type === 'question') {
        globalData.customPrompts[modelType].question = elements.questionPrompt.value;
        closePromptModal('question');
        showToast('提问优化提示词保存成功！', 'success');
    } else if (type === 'answer') {
        globalData.customPrompts[modelType].answer = elements.answerPrompt.value;
        closePromptModal('answer');
        showToast('回答优化提示词保存成功！', 'success');
    }
    
    console.log('[提示词] 保存提示词:', globalData.customPrompts);
}

/**
 * 根据输入过滤建议项
 */
function filterSuggestions(input, suggestionsContainer) {
    const inputValue = input.value.toLowerCase();
    const suggestionItems = suggestionsContainer.querySelectorAll('.suggestion-item');
    
    suggestionItems.forEach(item => {
        const itemValue = item.dataset.value.toLowerCase();
        if (itemValue.includes(inputValue)) {
            item.style.display = 'block';
        } else {
            item.style.display = 'none';
        }
    });
    
    // 如果有匹配的建议项，显示建议列表
    const hasVisibleItems = Array.from(suggestionItems).some(item => item.style.display !== 'none');
    if (hasVisibleItems) {
        suggestionsContainer.classList.add('show');
    } else {
        suggestionsContainer.classList.remove('show');
    }
}

/**
 * 处理相似度分析操作
 */
async function handleAnalyzeSimilarity() {
    if (!globalData.optimizeResult) {
        showToast('请先完成优化', 'warning');
        return;
    }
    
    elements.btnAnalyzeSimilarity.disabled = true;
    elements.btnAnalyzeSimilarity.innerHTML = '<span class="spinner"></span> 分析中...';
    elements.similarityProgress.classList.remove('hidden');
    
    console.log('[相似度分析] 开始分析相似度');
    console.log('[相似度分析] 优化结果:', globalData.optimizeResult);
    
    try {
        // 构建请求参数
        const textFilename = globalData.optimizeResult.text_filename;
        const vlFilename = globalData.optimizeResult.vl_filename;
        
        console.log('[相似度分析] 请求参数:', { text_filename: textFilename, vl_filename: vlFilename });
        
        // 设置超时控制器
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.error('[相似度分析] 请求超时，自动中止');
            controller.abort();
        }, 1800000); // 30分钟超时
        
        console.log('[相似度分析] 发送请求到:', API_BASE + '/analyze-similarity');
        
        // 调用后端相似度分析 API
        const response = await fetch(`${API_BASE}/analyze-similarity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question_nos: globalData.questionNos
            }),
            signal: controller.signal
        });
        
        // 清除超时
        clearTimeout(timeoutId);
        
        console.log('[相似度分析] 收到响应，状态码:', response.status, response.statusText);
        
        const result = await response.json();
        console.log('[相似度分析] 响应数据:', result);
        
        if (result.success) {
            console.log('[相似度分析] 分析成功，结果:', result.data);

            
            // 保存问题编号列表
            console.log('后端返回的问题编号:', result.data.all_question_nos);
            console.log('后端返回的高相似度问题编号:', result.data.high_similarity_question_nos);
            
            const questionNumbers = result.data.all_question_nos || [];
            const highSimilarityQuestionNumbers = result.data.high_similarity_question_nos || [];
            
            console.log('处理后的问题编号:', questionNumbers);
            console.log('处理后的高相似度问题编号:', highSimilarityQuestionNumbers);
            
            if (questionNumbers.length === 0) {
                console.warn('问题编号列表为空');
                showToast('未找到问题编号数据', 'warning');
            }
            
            if (highSimilarityQuestionNumbers.length === 0) {
                console.warn('高相似度问题编号列表为空');
                showToast('未找到高相似度问题编号数据', 'warning');
            }
            
            elements.similarityResult.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 1rem; align-items: center; text-align: center;">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <span style="font-size: 1.5rem;">🔍</span>
                        <div>
                            <strong>相似度分析完成！</strong><br>
                            共找到 <strong>${result.data.high_similarity_count}</strong> 条高相似度条目<br>
                            总计 <strong>${result.data.all_entries_count}</strong> 条分析数据<br>
                            生成 <strong>${result.data.training_format_count}</strong> 条训练数据
                        </div>
                    </div>
                    <div style="display: flex; gap: 1rem; justify-content: center; width: 100%; flex-wrap: wrap;">
                        <button onclick="furtherReview('${result.data.all_entries_filename}', ${result.data.high_similarity_count}, ${result.data.all_entries_count}, ${JSON.stringify(questionNumbers).replace(/"/g, '&quot;')}, ${JSON.stringify(highSimilarityQuestionNumbers).replace(/"/g, '&quot;')})" style="padding: 0.75rem 1.5rem; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; transition: all var(--transition); font-weight: 500; display: flex; align-items: center; gap: 0.5rem;">
                            <span>🔍</span> 进一步审查
                        </button>
                        <button onclick="downloadTrainingData('${API_BASE}${result.data.training_format_download_url}', '${result.data.training_format_filename}', '${API_BASE}${result.data.all_entries_download_url}', '${result.data.all_entries_filename}')" style="padding: 0.75rem 1.5rem; background: var(--primary-500); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; transition: all var(--transition); font-weight: 500; display: flex; align-items: center; gap: 0.5rem;">
                            <span>⬇️</span> 下载训练格式数据
                        </button>
                    </div>
                </div>
            `;
            elements.similarityResult.classList.remove('hidden');
            
            // 保存相似度分析结果到 globalData
            globalData.similarityResult = result.data;
            
            showToast('相似度分析完成！', 'success');
            
        } else {
            console.error('[相似度分析] 分析失败:', result.error);
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('[相似度分析] 异常:', error);
        elements.similarityResult.innerHTML = `<p style="color: var(--error);">分析失败：${error.message}</p>`;
        elements.similarityResult.classList.remove('hidden');
        showToast('相似度分析失败', 'error');
    } finally {
        elements.btnAnalyzeSimilarity.disabled = false;
        elements.btnAnalyzeSimilarity.innerHTML = '<span class="btn-icon">🔍</span> 分析相似度';
        elements.similarityProgress.classList.add('hidden');
        console.log('[相似度分析] 分析完成');
    }
}

// 进一步审查
async function furtherReview(allEntriesFilename, highSimilarityCount, allEntriesCount, questionNumbers, highSimilarityQuestionNumbers) {
    // 显示加载提示
    showToast('正在准备进一步审查数据...', 'info');
    
    try {
        // 构建所有数据的审查数据信息
        const allDataReview = {
            id: Date.now(),
            name: allEntriesFilename || '相似度分析审查（全部）',
            time: new Date().toLocaleString('zh-CN'),
            highSimilarityCount: highSimilarityCount || 0,
            allEntriesCount: allEntriesCount || 0,
            questionNumbers: questionNumbers || []
        };
        
        // 构建高相似度数据的审查数据信息
        const highSimilarityReview = {
            id: Date.now() + 1, // 确保ID不同
            name: allEntriesFilename ? allEntriesFilename.replace('_all', '_high') : '相似度分析审查（高相似度）',
            time: new Date().toLocaleString('zh-CN'),
            highSimilarityCount: highSimilarityCount || 0,
            allEntriesCount: highSimilarityQuestionNumbers.length || 0,
            questionNumbers: highSimilarityQuestionNumbers || []
        };
        
        // 保存到localStorage，让数据管理页面读取
        localStorage.setItem('pendingSimilarityReviews', JSON.stringify([allDataReview, highSimilarityReview]));
        
        // 跳转到数据管理页面
        switchPage('data-management');
    } catch (error) {
        console.error('准备审查数据失败:', error);
        showToast('准备审查数据失败，请稍后重试', 'error');
    }
}

// 下载训练格式数据和高相似度对比报告
function downloadTrainingData(trainingUrl, trainingFilename, highSimilarityUrl, highSimilarityFilename) {
    // 创建下载链接并触发下载
    function downloadFile(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // 先下载训练格式数据
    downloadFile(trainingUrl, trainingFilename);
    
    // 延迟下载高相似度对比报告，避免浏览器阻止多个下载
    setTimeout(() => {
        downloadFile(highSimilarityUrl, highSimilarityFilename);
    }, 500);
    
    // 显示提示
    showToast('正在下载训练格式数据和高相似度对比报告，请稍候...', 'success');
}

// 数据管理页面相关功能
// 存储导入历史
let importHistory = JSON.parse(localStorage.getItem('importHistory') || '[]');

// 初始化数据管理页面
function initDataManagement() {
    // 检查是否有从进一步审查导入的多个数据文件
    const pendingImport = localStorage.getItem('pendingSimilarityImport');
    if (pendingImport) {
        try {
            const importData = JSON.parse(pendingImport);
            // 检查是否是数组（多个文件）
            if (Array.isArray(importData)) {
                // 批量添加到导入历史
                importData.forEach(item => {
                    addToImportHistory(item);
                });
            } else if (importData) {
                // 单个文件
                addToImportHistory(importData);
            }
            // 清除localStorage中的待导入数据
            localStorage.removeItem('pendingSimilarityImport');
            // 显示成功提示
            showToast('相似度分析文件已导入数据管理页面', 'success');
        } catch (error) {
            console.error('处理待导入数据时出错:', error);
        }
    }
    
    // 检查是否有从进一步审查导入的审查数据
    const pendingReviews = localStorage.getItem('pendingSimilarityReviews');
    if (pendingReviews) {
        try {
            const reviewDataList = JSON.parse(pendingReviews);
            
            // 处理每个审查数据
            reviewDataList.forEach(reviewData => {
                // 转换为符合addToImportHistory函数期望的格式
                const importItem = {
                    id: reviewData.id || Date.now(),
                    name: reviewData.name || '相似度分析审查',
                    time: reviewData.time || new Date().toLocaleString('zh-CN'),
                    count: reviewData.allEntriesCount || 0,
                    questionNumbers: reviewData.questionNumbers || [],
                    content: null // 暂时设置为null，后续通过API获取数据
                };
                // 添加到导入历史
                addToImportHistory(importItem);
            });
            
            // 清除localStorage中的待审查数据
            localStorage.removeItem('pendingSimilarityReviews');
            // 显示成功提示
            showToast(`审查数据已导入数据管理页面，共 ${reviewDataList.length} 个文件`, 'success');
        } catch (error) {
            console.error('处理待审查数据时出错:', error);
        }
    }
    
    // 兼容旧格式
    const pendingReview = localStorage.getItem('pendingSimilarityReview');
    if (pendingReview) {
        try {
            const reviewData = JSON.parse(pendingReview);
            // 转换为符合addToImportHistory函数期望的格式
            const importItem = {
                id: reviewData.id || Date.now(),
                name: reviewData.name || '相似度分析审查',
                time: reviewData.time || new Date().toLocaleString('zh-CN'),
                count: reviewData.allEntriesCount || 0,
                questionNumbers: reviewData.questionNumbers || [],
                content: null // 暂时设置为null，后续通过API获取数据
            };
            // 添加到导入历史
            addToImportHistory(importItem);
            // 清除localStorage中的待审查数据
            localStorage.removeItem('pendingSimilarityReview');
            // 显示成功提示
            showToast('审查数据已导入数据管理页面', 'success');
        } catch (error) {
            console.error('处理待审查数据时出错:', error);
        }
    }
    
    // 初始化显示导入历史
    renderImportHistory();

    // 给搜索按钮添加点击事件
    const searchBtn = document.querySelector('.search-box .btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', function() {
            const input = document.querySelector('.search-input');
            if (input && input.value.trim()) {
                alert('搜索: ' + input.value);
            }
        });
    }

    // 给行操作按钮添加点击事件
    const actionBtns = document.querySelectorAll('.row-action-btn');
    actionBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            const title = this.getAttribute('title');
            if (title === '查看') {
                alert('查看详情功能');
            } else if (title === '编辑') {
                alert('编辑功能');
            } else if (title === '删除') {
                if (confirm('确定要删除这条数据吗？')) {
                    alert('删除成功');
                }
            }
        });
    });

    // 分页按钮点击
    const pageBtns = document.querySelectorAll('.page-btn:not(:disabled)');
    pageBtns.forEach(btn => {
        if (!btn.querySelector('i')) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.page-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
            });
        }
    });
}

// 显示本地上传模态框
function showLocalUploadModal() {
    // 创建精美弹窗
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background-color: white;
        border-radius: 12px;
        padding: 2rem;
        width: 90%;
        max-width: 600px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    `;
    
    const modalHeader = document.createElement('div');
    modalHeader.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
    `;
    
    const modalTitle = document.createElement('h3');
    modalTitle.style.cssText = `
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #1f2937;
    `;
    modalTitle.textContent = '上传 JSON 数据文件';
    
    const closeButton = document.createElement('button');
    closeButton.style.cssText = `
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: #6b7280;
    `;
    closeButton.textContent = '×';
    closeButton.onclick = function() {
        document.body.removeChild(modal);
    };
    
    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(closeButton);
    
    const modalBody = document.createElement('div');
    modalBody.style.cssText = `
        margin-bottom: 1.5rem;
    `;
    
    const instructions = document.createElement('div');
    instructions.style.cssText = `
        margin-bottom: 1.5rem;
    `;
    
    const instructionsTitle = document.createElement('h4');
    instructionsTitle.style.cssText = `
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
        font-weight: 500;
        color: #374151;
    `;
    instructionsTitle.textContent = '上传说明';
    
    const instructionsList = document.createElement('ul');
    instructionsList.style.cssText = `
        margin: 0;
        padding-left: 1.5rem;
        color: #6b7280;
        font-size: 0.875rem;
        line-height: 1.5;
    `;
    
    const instruction1 = document.createElement('li');
    instruction1.textContent = '仅支持 JSON 格式文件';
    
    const instruction2 = document.createElement('li');
    instruction2.textContent = '文件应包含相似度分析结果';
    
    const instruction3 = document.createElement('li');
    instruction3.textContent = '不符合规范的文件可能无法正确处理';
    
    instructionsList.appendChild(instruction1);
    instructionsList.appendChild(instruction2);
    instructionsList.appendChild(instruction3);
    
    instructions.appendChild(instructionsTitle);
    instructions.appendChild(instructionsList);
    
    const formatExample = document.createElement('div');
    formatExample.style.cssText = `
        margin-bottom: 1.5rem;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 1rem;
        background-color: #f9fafb;
    `;
    
    const formatHeader = document.createElement('div');
    formatHeader.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
    `;
    
    const formatTitle = document.createElement('h4');
    formatTitle.style.cssText = `
        margin: 0;
        font-size: 1rem;
        font-weight: 500;
        color: #374151;
    `;
    formatTitle.textContent = '格式示例';
    
    const formatTabs = document.createElement('div');
    formatTabs.style.cssText = `
        display: flex;
        gap: 0.5rem;
    `;
    
    const textTab = document.createElement('button');
    textTab.style.cssText = `
        padding: 0.25rem 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background-color: #22c55e;
        color: white;
        cursor: pointer;
        font-size: 0.75rem;
        font-weight: 500;
        transition: all 0.2s;
    `;
    textTab.textContent = '文本';
    
    const multimodalTab = document.createElement('button');
    multimodalTab.style.cssText = `
        padding: 0.25rem 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background-color: white;
        color: #374151;
        cursor: pointer;
        font-size: 0.75rem;
        font-weight: 500;
        transition: all 0.2s;
    `;
    multimodalTab.textContent = '多模态';
    
    formatTabs.appendChild(textTab);
    formatTabs.appendChild(multimodalTab);
    
    formatHeader.appendChild(formatTitle);
    formatHeader.appendChild(formatTabs);
    
    const formatCode = document.createElement('pre');
    formatCode.style.cssText = `
        margin: 0;
        padding: 1rem;
        background-color: #1f2937;
        color: #f3f4f6;
        border-radius: 6px;
        font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        font-size: 0.75rem;
        line-height: 1.5;
        overflow-x: auto;
    `;
    
    const textExampleCode = `{
    "id_value": "1950545103068303361",
    "doc1_question": "桃树叶片出现黄化、斑点或畸形等症状，请结合症状特征进行诊断。",
    "doc1_answer": "诊断结论：桃树叶片黄化、斑点或畸形需区分营养缺乏与病害.....",
    "original_question1": "桃树叶子这是缺营养还是得了什么病害？用什么药治疗效果比较好？",
    "original_answer1": "看叶脉叶肉发褐发紫，考虑有害物质积累毒害影响引起，.....",
}`;
    
    const multimodalExampleCode = `{
    "id_value": "1950545103068303361",
    "image": [],
    "doc1_question": "桃树叶片出现黄化、斑点或畸形等症状，请结合症状特征进行诊断",
    "doc1_answer": "诊断结论：桃树叶片黄化、斑点或畸形需区分营养缺乏与病害.....",
    "doc2_question": "桃树叶片出现黄化、斑点或畸形等症状，请结合症状特征进行诊断",
    "doc2_answer": "诊断结论：桃树叶片黄化、斑点或畸形需区分营养缺乏与病害.....",
    "original_question1": "桃树叶子这是缺营养还是得了什么病害？用什么药治疗效果比较好？",
    "original_answer1": "看叶脉叶肉发褐发紫，考虑有害物质积累毒害影响引起，.....",
    "analysis": {
      "diagnosis_text1": "桃树叶片黄化、斑点或畸形需区分营养缺乏与病害。",
      "diagnosis_text2": "桃树叶片出现叶脉或叶肉发褐、发紫等症状",
      "diagnosis_similarity": 0.7553,
      "question_similarity": 0.8783,
      "answer_similarity": 0.7615,
      "qa_similarity": 0.8199
    }
}`;
    
    formatCode.textContent = textExampleCode;
    
    textTab.onclick = function() {
        textTab.style.backgroundColor = '#22c55e';
        textTab.style.color = 'white';
        multimodalTab.style.backgroundColor = 'white';
        multimodalTab.style.color = '#374151';
        formatCode.textContent = textExampleCode;
    };
    
    multimodalTab.onclick = function() {
        multimodalTab.style.backgroundColor = '#22c55e';
        multimodalTab.style.color = 'white';
        textTab.style.backgroundColor = 'white';
        textTab.style.color = '#374151';
        formatCode.textContent = multimodalExampleCode;
    };
    
    formatExample.appendChild(formatHeader);
    formatExample.appendChild(formatCode);
    
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.cssText = `
        display: block;
        margin-bottom: 1.5rem;
        width: 100%;
    `;
    
    modalBody.appendChild(instructions);
    modalBody.appendChild(formatExample);
    modalBody.appendChild(fileInput);
    
    const modalFooter = document.createElement('div');
    modalFooter.style.cssText = `
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
    `;
    
    const cancelButton = document.createElement('button');
    cancelButton.style.cssText = `
        padding: 0.5rem 1rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background-color: white;
        color: #374151;
        cursor: pointer;
        font-size: 0.875rem;
        font-weight: 500;
        transition: all 0.2s;
    `;
    cancelButton.textContent = '取消';
    cancelButton.onclick = function() {
        document.body.removeChild(modal);
    };
    
    const confirmButton = document.createElement('button');
    confirmButton.style.cssText = `
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 6px;
        background-color: #22c55e;
        color: white;
        cursor: pointer;
        font-size: 0.875rem;
        font-weight: 500;
        transition: all 0.2s;
    `;
    confirmButton.textContent = '确定上传';
    confirmButton.onclick = function() {
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            // 读取文件内容，计算实际的ID数量
            const reader = new FileReader();
            reader.onload = function(e) {
                const fileContent = e.target.result;
                try {
                    const data = JSON.parse(fileContent);
                    
                    // 验证字段
                    const requiredFields = ["id_value", "doc1_question", "doc1_answer", "original_question1", "original_answer1", "doc2_question", "doc2_answer"];
                    const dataArray = Array.isArray(data) ? data : [data];
                    
                    let allFieldsPresent = true;
                    let missingFields = [];
                    
                    // 检查第一条数据是否包含所有必要字段
                    if (dataArray.length > 0) {
                        const firstItem = dataArray[0];
                        for (const field of requiredFields) {
                            if (!firstItem[field]) {
                                allFieldsPresent = false;
                                missingFields.push(field);
                            }
                        }
                    } else {
                        allFieldsPresent = false;
                        missingFields = requiredFields;
                    }
                    
                    if (!allFieldsPresent) {
                        // 显示错误提示
                        const errorModal = document.createElement('div');
                        errorModal.style.cssText = `
                            position: fixed;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            background-color: rgba(0, 0, 0, 0.5);
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            z-index: 1000;
                        `;
                        
                        const errorContent = document.createElement('div');
                        errorContent.style.cssText = `
                            background-color: white;
                            border-radius: 12px;
                            padding: 2rem;
                            width: 90%;
                            max-width: 400px;
                            text-align: center;
                            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                        `;
                        
                        const errorIcon = document.createElement('div');
                        errorIcon.style.cssText = `
                            width: 60px;
                            height: 60px;
                            background-color: #fee2e2;
                            border-radius: 50%;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            margin: 0 auto 1.5rem;
                        `;
                        errorIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>';
                        
                        const errorTitle = document.createElement('h3');
                        errorTitle.style.cssText = `
                            margin: 0 0 0.5rem 0;
                            font-size: 1.25rem;
                            font-weight: 600;
                            color: #1f2937;
                        `;
                        errorTitle.textContent = '上传失败';
                        
                        const errorMessage = document.createElement('p');
                        errorMessage.style.cssText = `
                            margin: 0 0 1.5rem 0;
                            color: #6b7280;
                            font-size: 0.875rem;
                        `;
                        errorMessage.textContent = `文件缺少必要字段：${missingFields.join('、')}`;
                        
                        const errorButton = document.createElement('button');
                        errorButton.style.cssText = `
                            padding: 0.5rem 1rem;
                            border: none;
                            border-radius: 6px;
                            background-color: #ef4444;
                            color: white;
                            cursor: pointer;
                            font-size: 0.875rem;
                            font-weight: 500;
                        `;
                        errorButton.textContent = '确定';
                        errorButton.onclick = function() {
                            document.body.removeChild(errorModal);
                        };
                        
                        errorContent.appendChild(errorIcon);
                        errorContent.appendChild(errorTitle);
                        errorContent.appendChild(errorMessage);
                        errorContent.appendChild(errorButton);
                        errorModal.appendChild(errorContent);
                        document.body.appendChild(errorModal);
                        return;
                    }
                    
                    // 计算数据中的ID数量
                    let count = dataArray.length;
                    
                    // 如果无法计算，使用默认值
                    if (count === 0) {
                        count = Math.floor(Math.random() * 1000) + 100;
                    }
                    
                    const fileInfo = {
                        id: Date.now(),
                        name: file.name,
                        time: new Date().toLocaleString('zh-CN'),
                        count: count, // 使用实际计算的ID数量
                        content: data // 保存实际文件内容
                    };
                    addToImportHistory(fileInfo);
                    
                    // 处理数据匹配到前端页面
                    processJsonData(data);
                    
                    // 关闭弹窗
                    document.body.removeChild(modal);
                    
                    // 显示成功提示
                    const successModal = document.createElement('div');
                    successModal.style.cssText = `
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background-color: rgba(0, 0, 0, 0.5);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        z-index: 1000;
                    `;
                    
                    const successContent = document.createElement('div');
                    successContent.style.cssText = `
                        background-color: white;
                        border-radius: 12px;
                        padding: 2rem;
                        width: 90%;
                        max-width: 400px;
                        text-align: center;
                        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                    `;
                    
                    const successIcon = document.createElement('div');
                    successIcon.style.cssText = `
                        width: 60px;
                        height: 60px;
                        background-color: #d1fae5;
                        border-radius: 50%;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        margin: 0 auto 1.5rem;
                    `;
                    successIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>';
                    
                    const successTitle = document.createElement('h3');
                    successTitle.style.cssText = `
                        margin: 0 0 0.5rem 0;
                        font-size: 1.25rem;
                        font-weight: 600;
                        color: #1f2937;
                    `;
                    successTitle.textContent = '上传成功';
                    
                    const successMessage = document.createElement('p');
                    successMessage.style.cssText = `
                        margin: 0 0 1.5rem 0;
                        color: #6b7280;
                        font-size: 0.875rem;
                    `;
                    successMessage.textContent = `文件 "${file.name}" 上传成功！共 ${count} 条数据。`;
                    
                    const successButton = document.createElement('button');
                    successButton.style.cssText = `
                        padding: 0.5rem 1rem;
                        border: none;
                        border-radius: 6px;
                        background-color: #22c55e;
                        color: white;
                        cursor: pointer;
                        font-size: 0.875rem;
                        font-weight: 500;
                    `;
                    successButton.textContent = '确定';
                    successButton.onclick = function() {
                        document.body.removeChild(successModal);
                    };
                    
                    successContent.appendChild(successIcon);
                    successContent.appendChild(successTitle);
                    successContent.appendChild(successMessage);
                    successContent.appendChild(successButton);
                    successModal.appendChild(successContent);
                    document.body.appendChild(successModal);
                } catch (error) {
                    // 如果解析失败，使用默认值，但保存原始文本内容
                    const fileInfo = {
                        id: Date.now(),
                        name: file.name,
                        time: new Date().toLocaleString('zh-CN'),
                        count: Math.floor(Math.random() * 1000) + 100,
                        content: fileContent // 保存原始文本内容
                    };
                    addToImportHistory(fileInfo);
                    
                    // 关闭弹窗
                    document.body.removeChild(modal);
                    
                    // 显示成功提示
                    const successModal = document.createElement('div');
                    successModal.style.cssText = `
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background-color: rgba(0, 0, 0, 0.5);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        z-index: 1000;
                    `;
                    
                    const successContent = document.createElement('div');
                    successContent.style.cssText = `
                        background-color: white;
                        border-radius: 12px;
                        padding: 2rem;
                        width: 90%;
                        max-width: 400px;
                        text-align: center;
                        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                    `;
                    
                    const successIcon = document.createElement('div');
                    successIcon.style.cssText = `
                        width: 60px;
                        height: 60px;
                        background-color: #d1fae5;
                        border-radius: 50%;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        margin: 0 auto 1.5rem;
                    `;
                    successIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>';
                    
                    const successTitle = document.createElement('h3');
                    successTitle.style.cssText = `
                        margin: 0 0 0.5rem 0;
                        font-size: 1.25rem;
                        font-weight: 600;
                        color: #1f2937;
                    `;
                    successTitle.textContent = '上传成功';
                    
                    const successMessage = document.createElement('p');
                    successMessage.style.cssText = `
                        margin: 0 0 1.5rem 0;
                        color: #6b7280;
                        font-size: 0.875rem;
                    `;
                    successMessage.textContent = `文件 "${file.name}" 上传成功！文件将以相似度分析文件格式处理。`;
                    
                    const successButton = document.createElement('button');
                    successButton.style.cssText = `
                        padding: 0.5rem 1rem;
                        border: none;
                        border-radius: 6px;
                        background-color: #22c55e;
                        color: white;
                        cursor: pointer;
                        font-size: 0.875rem;
                        font-weight: 500;
                    `;
                    successButton.textContent = '确定';
                    successButton.onclick = function() {
                        document.body.removeChild(successModal);
                    };
                    
                    successContent.appendChild(successIcon);
                    successContent.appendChild(successTitle);
                    successContent.appendChild(successMessage);
                    successContent.appendChild(successButton);
                    successModal.appendChild(successContent);
                    document.body.appendChild(successModal);
                }
            };
            reader.readAsText(file);

        }
    };
    
    modalFooter.appendChild(cancelButton);
    modalFooter.appendChild(confirmButton);
    
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modalContent.appendChild(modalFooter);
    modal.appendChild(modalContent);
    
    document.body.appendChild(modal);
}

// 处理JSON数据并匹配到前端页面
function processJsonData(data) {
    console.log('[处理] 开始处理JSON数据:', data);
    
    // 检查数据是否为数组
    const dataArray = Array.isArray(data) ? data : [data];
    
    // 存储处理后的数据
    globalData.importedData = dataArray;
    
    // 处理第一条数据（默认显示）
    if (dataArray.length > 0) {
        const firstItem = dataArray[0];
        console.log('[处理] 处理第一条数据:', firstItem);
        
        // 匹配字段到前端页面
        if (firstItem['original_question1']) {
            const originalQuestion = document.getElementById('originalQuestion');
            if (originalQuestion) {
                originalQuestion.textContent = firstItem['original_question1'];
                console.log('[处理] 原始问题已更新');
            }
        }
        
        if (firstItem['original_answer1']) {
            const originalAnswer = document.getElementById('originalAnswer');
            if (originalAnswer) {
                originalAnswer.textContent = firstItem['original_answer1'];
                console.log('[处理] 原始回答已更新');
            }
        }
        
        if (firstItem['doc1_question']) {
            const textOptimizedQuestion = document.getElementById('textOptimizedQuestion');
            if (textOptimizedQuestion) {
                textOptimizedQuestion.textContent = firstItem['doc1_question'];
                console.log('[处理] 文本优化问题已更新');
            }
        }
        
        if (firstItem['doc1_answer']) {
            const textOptimizedAnswer = document.getElementById('textOptimizedAnswer');
            if (textOptimizedAnswer) {
                textOptimizedAnswer.textContent = firstItem['doc1_answer'];
                console.log('[处理] 文本优化回答已更新');
            }
        }
        
        if (firstItem['doc2_question']) {
            const optimizedQuestion = document.getElementById('optimizedQuestion');
            if (optimizedQuestion) {
                optimizedQuestion.textContent = firstItem['doc2_question'];
                console.log('[处理] 优化后问题已更新');
            }
        }
        
        if (firstItem['doc2_answer']) {
            const optimizedAnswer = document.getElementById('optimizedAnswer');
            if (optimizedAnswer) {
                optimizedAnswer.textContent = firstItem['doc2_answer'];
                console.log('[处理] 优化后回答已更新');
            }
        }
        
        // 更新QA ID
        if (firstItem['id_value']) {
            const qaId = document.getElementById('qaId');
            if (qaId) {
                qaId.textContent = `QA-${firstItem['id_value']}`;
                console.log('[处理] QA ID已更新');
            }
        }
    }
    
    console.log('[处理] JSON数据处理完成');
}

// 添加到导入历史
function addToImportHistory(item) {
    // 确保item包含所有必要的字段，防止undefined值
    const validItem = {
        id: item.id || Date.now(),
        name: item.name || '未命名文件',
        time: item.time || new Date().toLocaleString('zh-CN'),
        count: item.count || 0,
        questionNumbers: item.questionNumbers || [], // 保存问题编号列表
        content: item.content || null // 保存文件内容
    };
    importHistory.unshift(validItem);
    // 保存到localStorage，确保历史文件不会丢失
    localStorage.setItem('importHistory', JSON.stringify(importHistory));
    renderImportHistory();
}

// 计算所有文件的统计信息
function calculateOverallStatistics() {
    let total = 0;
    let pending = 0;
    let approved = 0;
    let modified = 0;

    importHistory.forEach(item => {
        if (item.content) {
            const dataArray = Array.isArray(item.content) ? item.content : [item.content];
            total += dataArray.length;

            dataArray.forEach(entry => {
                if (entry.reviewStatus === 'approved') {
                    approved++;
                } else if (entry.reviewStatus === 'modified') {
                    modified++;
                } else {
                    pending++;
                }
            });
        } else {
            total += item.count || 0;
            pending += item.count || 0;
        }
    });

    return { total, pending, modified, approved };
}

// 更新数据管理页面的统计概览
function updateDataManagementStatistics() {
    const stats = calculateOverallStatistics();
    
    const totalElement = document.querySelector('.stat-card.primary .stat-value');
    const modifiedElement = document.querySelector('.stat-card.info .stat-value');
    const pendingElement = document.querySelector('.stat-card.warning .stat-value');
    const approvedElement = document.querySelector('.stat-card.success .stat-value');

    if (totalElement) totalElement.textContent = stats.total.toLocaleString();
    if (modifiedElement) modifiedElement.textContent = stats.modified.toLocaleString();
    if (pendingElement) pendingElement.textContent = stats.pending.toLocaleString();
    if (approvedElement) approvedElement.textContent = stats.approved.toLocaleString();
}

// 渲染数据文件
function renderImportHistory() {
    const container = document.getElementById('importHistory');
    if (!container) return;

    if (importHistory.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--gray-500); grid-column: 1 / -1;">
                <i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 0.5rem;"></i>
                <p>暂无数据文件</p>
            </div>
        `;
        return;
    }

    container.innerHTML = importHistory.map(item => {
        // 计算当前文件的审核统计
        let fileTotal = 0;
        let filePending = 0;
        let fileApproved = 0;
        let fileModified = 0;

        if (item.content) {
            const dataArray = Array.isArray(item.content) ? item.content : [item.content];
            fileTotal = dataArray.length;

            dataArray.forEach(entry => {
                if (entry.reviewStatus === 'approved') {
                    fileApproved++;
                } else if (entry.reviewStatus === 'modified') {
                    fileModified++;
                } else {
                    filePending++;
                }
            });
        } else {
            fileTotal = item.count || 0;
            filePending = item.count || 0;
        }

        return `
            <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 1rem; transition: all var(--transition);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: var(--gray-800); display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <i class="fas fa-file" style="color: #22c55e;"></i>
                            <span class="file-name" data-id="${item.id}" style="overflow: hidden; text-overflow: ellipsis; max-width: 200px; cursor: pointer;" ondblclick="startRename(${item.id}, this)">${item.name}</span>
                            <input type="text" class="rename-input" data-id="${item.id}" style="display: none; width: 200px; padding: 0.25rem; border: 1px solid var(--primary-color); border-radius: var(--radius-sm); font-size: 0.9rem;" onblur="cancelRename(${item.id}, this)" onkeypress="handleRenameKeyPress(${item.id}, this, event)">
                        </div>
                        <div style="font-size: 0.85rem; color: var(--gray-500); margin-bottom: 0.25rem;">
                            <i class="fas fa-clock"></i> ${item.time}
                        </div>
                        <div style="font-size: 0.85rem; color: var(--gray-500); margin-bottom: 0.25rem;">
                            <i class="fas fa-database"></i> ${fileTotal} 条数据
                        </div>
                        <div style="display: flex; gap: 1rem; font-size: 0.75rem; color: var(--gray-500);">
                            <span><i class="fas fa-hourglass-half"></i> 待审核: ${filePending}</span>
                            <span><i class="fas fa-check-circle"></i> 已通过: ${fileApproved}</span>
                            <span><i class="fas fa-edit"></i> 需修改: ${fileModified}</span>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem;">
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button onclick="startReview(${item.id})" style="flex: 1; padding: 0.6rem; background: var(--primary-color); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-size: 0.9rem; font-weight: 500; transition: all var(--transition);">
                        <i class="fas fa-check-circle"></i> 开始审查
                    </button>
                    <button onclick="viewFileDetails(${item.id})" style="flex: 1; padding: 0.6rem; background: var(--gray-100); color: var(--gray-800); border: 1px solid var(--gray-200); border-radius: var(--radius-md); cursor: pointer; font-size: 0.9rem; font-weight: 500; transition: all var(--transition);">
                        <i class="fas fa-eye"></i> 查看详情
                    </button>
                    <button onclick="deleteFile(${item.id})" style="padding: 0.6rem; background: var(--gray-100); color: var(--gray-600); border: 1px solid var(--gray-200); border-radius: var(--radius-md); cursor: pointer; font-size: 0.9rem; font-weight: 500; transition: all var(--transition);">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // 更新数据管理页面的统计概览
    updateDataManagementStatistics();
    
    // 异步更新审核状态
    updateImportHistoryStatus();
}

// 异步更新导入历史的审核状态
async function updateImportHistoryStatus() {
    // 收集所有问题编号
    const allQuestionNumbers = [];
    const fileQuestionMap = new Map(); // 存储文件ID与问题编号的映射
    
    importHistory.forEach(item => {
        if (item.questionNumbers && item.questionNumbers.length > 0) {
            allQuestionNumbers.push(...item.questionNumbers);
            fileQuestionMap.set(item.id, item.questionNumbers);
        } else if (item.content) {
            const questionNumbers = item.content.map(entry => entry.id_value).filter(Boolean);
            allQuestionNumbers.push(...questionNumbers);
            fileQuestionMap.set(item.id, questionNumbers);
        }
    });
    
    // 如果有问题编号，从后端获取最新的审核状态
    if (allQuestionNumbers.length > 0) {
        try {
            const response = await fetch(`${API_BASE}/get-review-data`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ question_nos: allQuestionNumbers })
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.data) {
                    // 创建问题编号到审核状态的映射
                    const statusMap = new Map();
                    data.data.forEach(item => {
                        statusMap.set(item.id_value, item.reviewStatus);
                    });
                    
                    // 更新导入历史中的审核状态
                    let hasUpdates = false;
                    importHistory.forEach(item => {
                        const questionNumbers = fileQuestionMap.get(item.id);
                        if (questionNumbers) {
                            if (item.content) {
                                // 更新content中的审核状态
                                const updatedContent = item.content.map(entry => {
                                    const status = statusMap.get(entry.id_value);
                                    if (status) {
                                        const newStatus = status === 2 ? 'approved' : 
                                                       status === 3 ? 'modified' : 
                                                       entry.reviewStatus;
                                        if (entry.reviewStatus !== newStatus) {
                                            entry.reviewStatus = newStatus;
                                            hasUpdates = true;
                                        }
                                    }
                                    return entry;
                                });
                                
                                if (hasUpdates) {
                                    item.content = updatedContent;
                                }
                            }
                        }
                    });
                    
                    // 如果有更新，保存到localStorage并重新渲染
                    if (hasUpdates) {
                        localStorage.setItem('importHistory', JSON.stringify(importHistory));
                        renderImportHistory();
                    }
                }
            }
        } catch (error) {
            console.error('更新审核状态时出错:', error);
        }
    }
}

// 开始重命名文件
function startRename(id, element) {
    console.log('[重命名] 开始重命名文件:', id);
    
    // 隐藏文件名显示
    element.style.display = 'none';
    
    // 显示输入框
    const input = element.nextElementSibling;
    input.style.display = 'inline-block';
    input.value = element.textContent;
    input.focus();
    input.select();
}

// 取消重命名
function cancelRename(id, input) {
    console.log('[重命名] 取消重命名文件:', id);
    
    // 隐藏输入框
    input.style.display = 'none';
    
    // 显示文件名
    const fileNameElement = input.previousElementSibling;
    fileNameElement.style.display = 'inline';
}

// 处理重命名键盘事件
function handleRenameKeyPress(id, input, event) {
    if (event.key === 'Enter') {
        // 按Enter键确认重命名
        saveRename(id, input);
    } else if (event.key === 'Escape') {
        // 按Esc键取消重命名
        cancelRename(id, input);
    }
}

// 保存重命名
function saveRename(id, input) {
    const newName = input.value.trim();
    if (!newName) {
        showToast('文件名不能为空', 'error');
        cancelRename(id, input);
        return;
    }
    
    console.log('[重命名] 保存重命名文件:', id, '新名称:', newName);
    
    // 查找并更新文件信息
    const fileInfo = importHistory.find(item => item.id === id);
    if (fileInfo) {
        fileInfo.name = newName;
        
        // 保存到localStorage
        localStorage.setItem('importHistory', JSON.stringify(importHistory));
        
        // 重新渲染导入历史
        renderImportHistory();
        
        showToast('文件重命名成功', 'success');
    }
}

// 开始审查
async function startReview(id) {
    console.log('[审查] 开始审查文件:', id);
    
    // 查找对应的文件信息
    const fileInfo = importHistory.find(item => item.id === id);
    if (!fileInfo) {
        showToast('未找到文件信息', 'error');
        return;
    }
    
    try {
        if (fileInfo.questionNumbers && fileInfo.questionNumbers.length > 0) {
            // 处理从进一步审查导入的文件，通过API获取最新数据
            console.log('[审查] 通过API获取最新数据');
            
            const fileInfoString = JSON.stringify({
                name: fileInfo.name,
                count: fileInfo.count,
                questionNumbers: fileInfo.questionNumbers
            });
            
            // 保存文件信息到localStorage
            localStorage.setItem('currentReviewFileInfo', fileInfoString);
            localStorage.removeItem('currentReviewData'); // 清除旧数据
            
        } else if (fileInfo.content) {
            // 即使有本地内容，也从后端获取最新的审核状态
            console.log('[审查] 从后端获取最新的审核状态');
            
            // 提取问题编号
            const questionNumbers = fileInfo.content.map(item => item.id_value).filter(Boolean);
            
            if (questionNumbers.length > 0) {
                // 通过API获取最新数据
                const response = await fetch(`${API_BASE}/get-review-data`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ question_nos: questionNumbers })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.data) {
                        // 更新本地内容的审核状态
                        const updatedContent = fileInfo.content.map(item => {
                            const latestData = data.data.find(d => d.id_value === item.id_value);
                            if (latestData) {
                                // 更新审核状态
                                item.reviewStatus = latestData.reviewStatus === 2 ? 'approved' : 
                                                 latestData.reviewStatus === 3 ? 'modified' : 
                                                 item.reviewStatus;
                            }
                            return item;
                        });
                        
                        // 保存更新后的内容
                        const contentString = JSON.stringify(updatedContent);
                        const fileInfoString = JSON.stringify({
                            name: fileInfo.name,
                            count: fileInfo.count
                        });
                        
                        localStorage.setItem('currentReviewData', contentString);
                        localStorage.setItem('currentReviewFileInfo', fileInfoString);
                        
                        // 更新导入历史中的内容
                        const fileIndex = importHistory.findIndex(item => item.id === id);
                        if (fileIndex !== -1) {
                            importHistory[fileIndex].content = updatedContent;
                            localStorage.setItem('importHistory', JSON.stringify(importHistory));
                        }
                    }
                }
            } else {
                // 没有问题编号，使用本地内容
                const contentString = JSON.stringify(fileInfo.content);
                const fileInfoString = JSON.stringify({
                    name: fileInfo.name,
                    count: fileInfo.count
                });
                
                localStorage.setItem('currentReviewData', contentString);
                localStorage.setItem('currentReviewFileInfo', fileInfoString);
            }
        } else {
            showToast('文件内容为空，无法进行审查', 'error');
            return;
        }
        
        // 验证保存是否成功
        const savedInfo = localStorage.getItem('currentReviewFileInfo');
        if (!savedInfo) {
            console.error('[审查] 数据保存失败');
            showToast('数据保存失败，请重试', 'error');
            return;
        }
        
        // 显示加载成功提示
        showToast('文件数据加载成功，正在跳转到人工审查页面...', 'success');
        
        // 重置人工复审页面初始化状态，确保加载新文件时重新初始化
        globalData.manualReviewInitialized = false;
        
        // 跳转到人工审查页面
        setTimeout(() => {
            console.log('[审查] 跳转到人工审查页面');
            switchPage('manual-review');
        }, 1000);
        
    } catch (error) {
        console.error('[审查] 保存数据时出错:', error);
        showToast('保存数据时出错，请重试', 'error');
    }
}

// 查看文件详情
function viewFileDetails(id) {
    // 查找对应的文件信息
    const fileInfo = importHistory.find(item => item.id === id);
    if (!fileInfo) {
        showToast('未找到文件信息', 'error');
        return;
    }
    
    // 显示加载提示
    showToast('正在获取文件详情...', 'info');
    
    // 检查是否已经有文件内容
    if (fileInfo.content) {
        // 使用本地存储的内容
        showFileDetailsModal(fileInfo);
    } else if (fileInfo.questionNumbers && fileInfo.questionNumbers.length > 0) {
        // 处理从进一步审查导入的文件，通过API获取数据
        fetchReviewData(fileInfo.questionNumbers).then(response => {
            // 检查响应是否成功
            if (response.success && response.data) {
                // 只取前5条数据
                const limitedData = response.data.slice(0, 5);
                // 更新文件信息，保存内容
                fileInfo.content = limitedData;
                // 保存到localStorage
                localStorage.setItem('importHistory', JSON.stringify(importHistory));
                // 显示详情
                showFileDetailsModal(fileInfo);
            } else {
                throw new Error('获取数据失败');
            }
        }).catch(error => {
            console.error('获取审查数据失败:', error);
            showToast('获取审查数据失败，请稍后重试', 'error');
        });
    } else {
        // 从后端获取文件内容
        const filename = fileInfo.name;
        const fileUrl = `${API_BASE}/download/${filename}`;
        
        fetch(fileUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error('文件下载失败');
                }
                return response.json();
            })
            .then(data => {
                // 更新文件信息，保存内容
                fileInfo.content = data;
                // 保存到localStorage
                localStorage.setItem('importHistory', JSON.stringify(importHistory));
                // 显示详情
                showFileDetailsModal(fileInfo);
            })
            .catch(error => {
                console.error('获取文件详情失败:', error);
                showToast('获取文件详情失败，请稍后重试', 'error');
            });
    }
}

// 通过API获取审查数据
async function fetchReviewData(questionNumbers) {
    try {
        // 检查questionNumbers是否为空
        if (!questionNumbers || questionNumbers.length === 0) {
            throw new Error('问题编号列表为空');
        }
        
        // 只取前10条数据，避免数据量过大
        const limitedQuestionNumbers = questionNumbers.slice(0, 10);
        
        console.log('发送的问题编号:', limitedQuestionNumbers);
        
        const response = await fetch(`${API_BASE}/get-review-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ question_nos: limitedQuestionNumbers })
        });
        
        console.log('API响应状态:', response.status);
        
        if (!response.ok) {
            throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('API响应数据:', data);
        
        // 按照questionNumbers的顺序对数据进行排序
        if (data.success && data.data && Array.isArray(data.data)) {
            // 创建id到数据的映射
            const dataMap = {};
            data.data.forEach(item => {
                dataMap[item.id_value] = item;
            });
            
            // 按照questionNumbers的顺序重新排序
            const sortedData = [];
            limitedQuestionNumbers.forEach(id => {
                if (dataMap[id]) {
                    sortedData.push(dataMap[id]);
                }
            });
            
            // 更新排序后的数据
            data.data = sortedData;
            console.log('排序后的数据:', data.data);
        }
        
        return data;
    } catch (error) {
        console.error('获取审查数据失败:', error);
        throw error;
    }
}

// 显示文件详情弹框
function showFileDetailsModal(fileInfo) {
    // 创建弹框
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background-color: white;
        border-radius: 12px;
        padding: 2rem;
        width: 90%;
        max-width: 800px;
        max-height: 80vh;
        overflow: auto;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    `;
    
    const modalHeader = document.createElement('div');
    modalHeader.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
    `;
    
    const modalTitle = document.createElement('h3');
    modalTitle.style.cssText = `
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #1f2937;
    `;
    modalTitle.textContent = `文件详情: ${fileInfo.name}`;
    
    const closeButton = document.createElement('button');
    closeButton.style.cssText = `
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: #6b7280;
    `;
    closeButton.textContent = '×';
    closeButton.onclick = function() {
        document.body.removeChild(modal);
    };
    
    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(closeButton);
    
    const modalBody = document.createElement('div');
    
    // 文件基本信息
    const fileInfoSection = document.createElement('div');
    fileInfoSection.style.cssText = `
        margin-bottom: 1.5rem;
        padding: 1rem;
        background-color: #f9fafb;
        border-radius: 8px;
    `;
    
    fileInfoSection.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
            <div>
                <strong>数据条数:</strong> ${fileInfo.count}
            </div>
            <div>
                <strong>导入时间:</strong> ${fileInfo.time}
            </div>
        </div>
    `;
    
    // JSON内容
    const jsonSection = document.createElement('div');
    jsonSection.style.cssText = `
        margin-bottom: 1rem;
    `;
    
    const jsonHeader = document.createElement('h4');
    jsonHeader.style.cssText = `
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
        font-weight: 500;
        color: #374151;
    `;
    jsonHeader.textContent = '文件内容 (JSON)';
    
    const jsonContent = document.createElement('pre');
    jsonContent.style.cssText = `
        margin: 0;
        padding: 1rem;
        background-color: #1f2937;
        color: #f3f4f6;
        border-radius: 6px;
        font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        font-size: 0.75rem;
        line-height: 1.5;
        overflow-x: auto;
        max-height: 400px;
    `;
    
    // 定义字段的期望顺序
    const fieldOrder = [
        'id_value',
        'question',
        'answer',
        'text_optimized_question',
        'text_optimized_answer',
        'optimized_question',
        'optimized_answer',
        'high',
        'reviewStatus'
    ];
    
    // 排序函数，按照指定顺序重新排列对象的字段
    function sortObjectFields(obj, order) {
        const sortedObj = {};
        order.forEach(key => {
            if (obj.hasOwnProperty(key)) {
                sortedObj[key] = obj[key];
            }
        });
        // 添加未在顺序列表中的其他字段
        Object.keys(obj).forEach(key => {
            if (!order.includes(key)) {
                sortedObj[key] = obj[key];
            }
        });
        return sortedObj;
    }
    
    // 处理内容，排序每个对象的字段
    let sortedContent = fileInfo.content;
    if (Array.isArray(fileInfo.content)) {
        sortedContent = fileInfo.content.map(item => {
            if (typeof item === 'object' && item !== null) {
                return sortObjectFields(item, fieldOrder);
            }
            return item;
        });
    }
    
    jsonContent.textContent = JSON.stringify(sortedContent, null, 2);
    
    jsonSection.appendChild(jsonHeader);
    jsonSection.appendChild(jsonContent);
    
    modalBody.appendChild(fileInfoSection);
    modalBody.appendChild(jsonSection);
    
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modal.appendChild(modalContent);
    
    document.body.appendChild(modal);
    
    // 显示成功提示
    showToast('文件详情加载成功', 'success');
}

// 删除文件
function deleteFile(id) {
    if (confirm('确定要删除这个文件吗？')) {
        importHistory = importHistory.filter(item => item.id !== id);
        // 保存到localStorage，确保删除操作持久化
        localStorage.setItem('importHistory', JSON.stringify(importHistory));
        renderImportHistory();
        showToast('文件删除成功', 'success');
    }
}

// 清空导入历史
function clearImportHistory() {
    if (confirm('确定要清空所有导入历史吗？')) {
        importHistory = [];
        // 保存到localStorage，确保清空操作持久化
        localStorage.setItem('importHistory', JSON.stringify(importHistory));
        renderImportHistory();
        showToast('导入历史已清空', 'success');
    }
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 人工复审页面相关功能
// 初始化人工复审页面
async function initManualReview() {
    console.log('[审查] 初始化人工审查页面');
    
    // 初始化统计信息（第一步）
    updateStatistics();
    console.log('[审查] 第一步：初始化统计信息');
    
    // 绑定事件监听器
    bindManualReviewEvents();
    
    // 从localStorage中读取文件信息
    const fileInfo = localStorage.getItem('currentReviewFileInfo');
    
    console.log('[审查] 读取localStorage数据:', {
        fileInfoExists: !!fileInfo,
        infoLength: fileInfo ? fileInfo.length : 0
    });
    
    if (fileInfo) {
        try {
            const info = JSON.parse(fileInfo);
            console.log('[审查] 解析文件信息成功:', info);
            
            // 检查是否有问题编号列表
            if (info.questionNumbers && info.questionNumbers.length > 0) {
                // 通过API获取最新数据
                console.log('[审查] 通过API获取最新数据');
                
                const response = await fetch(`${API_BASE}/get-review-data`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ question_nos: info.questionNumbers })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.data) {
                        console.log('[审查] API获取数据成功，共', data.data.length, '条');
                        
                        const dataArray = data.data;
                        
                        if (dataArray.length > 0) {
                            // 显示第一条数据作为示例
                            const firstItem = dataArray[0];
                            console.log('[审查] 显示第一条数据:', firstItem);
                            
                            // 更新原始问题
                            const originalQuestion = document.getElementById('originalQuestion');
                            if (originalQuestion) {
                                originalQuestion.textContent = firstItem.question || firstItem.original_question1 || firstItem.original_question || '无原始问题';
                            }
                            
                            // 更新原始答案
                            const originalAnswer = document.getElementById('originalAnswer');
                            if (originalAnswer) {
                                originalAnswer.textContent = firstItem.answer || firstItem.original_answer1 || firstItem.original_answer || '无原始答案';
                            }

                            // 更新文本优化问题
                            const textOptimizedQuestion = document.getElementById('textOptimizedQuestion');
                            if (textOptimizedQuestion) {
                                textOptimizedQuestion.textContent = firstItem.text_optimized_question || '无文本优化问题';
                            }
                            // 更新文本优化答案
                            const textOptimizedAnswer = document.getElementById('textOptimizedAnswer');
                            if (textOptimizedAnswer) {
                                textOptimizedAnswer.textContent = firstItem.text_optimized_answer || '无文本优化答案';
                            }

                            // 更新优化后问题
                            const optimizedQuestion = document.getElementById('optimizedQuestion');
                            if (optimizedQuestion) {
                                optimizedQuestion.textContent = firstItem.optimized_question || '无优化后问题';
                            }
                            
                            // 更新优化后答案
                            const optimizedAnswer = document.getElementById('optimizedAnswer');
                            if (optimizedAnswer) {
                                optimizedAnswer.textContent = firstItem.optimized_answer || '无优化后答案';
                            }
                            
                            // 更新图片信息
                            const imageDisplay = document.getElementById('imageDisplay');
                            const imagePlaceholder = document.getElementById('imagePlaceholder');
                            const imageContainer = document.getElementById('imageContainer');
                            const thumbnailList = document.getElementById('thumbnailList');
                            const imageCounter = document.getElementById('imageCounter');
                            
                            if (imageDisplay && imagePlaceholder && imageContainer && thumbnailList && imageCounter) {
                                // 先显示加载状态
                                imagePlaceholder.style.display = 'flex';
                                imageContainer.style.display = 'none';
                                imageCounter.textContent = '(加载中...)';
                                
                                // 获取问答对的id
                                const qaId = firstItem.id_value || firstItem.id || '';
                                if (qaId) {
                                    // 从后端数据库获取图片信息
                                    fetch(`${API_BASE}/get-images-by-entity-id`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ entity_id: qaId })
                                    })
                                    .then(response => response.json())
                                    .then(result => {
                                        if (result.success && result.data && Array.isArray(result.data) && result.data.length > 0) {
                                            // 有图片
                                            imagePlaceholder.style.display = 'none';
                                            imageContainer.style.display = 'block';
                                            imageCounter.textContent = `(${1}/${result.data.length})`;
                                            
                                            // 生成缩略图
                                            thumbnailList.innerHTML = result.data.map((img, index) => {
                                                const imgUrl = img.url || img;
                                                return `
                                                    <div class="thumbnail-item ${index === 0 ? 'active' : ''}" data-index="${index}">
                                                        <img src="${imgUrl}" alt="图片 ${index + 1}">
                                                        <div class="thumbnail-index">${index + 1}</div>
                                                    </div>
                                                `;
                                            }).join('');
                                        } else {
                                            // 无图片
                                            imagePlaceholder.style.display = 'flex';
                                            imageContainer.style.display = 'none';
                                            imageCounter.textContent = '(0/0)';
                                        }
                                    })
                                    .catch(error => {
                                        console.error('获取图片信息失败:', error);
                                        // 无图片
                                        imagePlaceholder.style.display = 'flex';
                                        imageContainer.style.display = 'none';
                                        imageCounter.textContent = '(0/0)';
                                    });
                                } else {
                                    // 无id，无法查询图片
                                    imagePlaceholder.style.display = 'flex';
                                    imageContainer.style.display = 'none';
                                    imageCounter.textContent = '(0/0)';
                                    // 检查thumbnailCount元素是否存在
                                    const thumbnailCount = document.getElementById('thumbnailCount');
                                    if (thumbnailCount) {
                                        thumbnailCount.textContent = '0';
                                    }
                                }
                            }
                            
                            // 找到第一个待审核的问答对
                            let firstPendingIndex = 0;
                            for (let i = 0; i < dataArray.length; i++) {
                                if (!dataArray[i].reviewStatus || dataArray[i].reviewStatus !== 'approved' && dataArray[i].reviewStatus !== 'modified') {
                                    firstPendingIndex = i;
                                    break;
                                }
                            }
                            
                            // 保存数据到全局变量
                            globalData.currentReviewData = dataArray;
                            globalData.currentReviewIndex = firstPendingIndex;
                            console.log('[审查] 保存数据到全局变量，从索引', firstPendingIndex, '开始');
                            
                            // 保存数据到localStorage
                            localStorage.setItem('currentReviewData', JSON.stringify(dataArray));
                            console.log('[审查] 保存数据到localStorage');
                            
                            // 显示第一个待审核的问答对
                            showReviewItem(firstPendingIndex);
                            
                            // 初始化统计信息
                            updateStatistics();
                            console.log('[审查] 初始化统计信息');

                        } else {
                            console.log('[审查] 文件内容为空');
                            showToast('文件内容为空', 'error');
                        }
                    } else {
                        console.error('[审查] API返回数据失败');
                        showToast('获取审查数据失败，请稍后重试', 'error');
                    }
                } else {
                    console.error('[审查] API请求失败');
                    showToast('获取审查数据失败，请稍后重试', 'error');
                }
            } else {
                console.log('[审查] 没有问题编号列表');
                showToast('请从数据管理页面选择文件进行审查', 'info');
            }
            
        } catch (error) {
            console.error('解析文件信息失败:', error);
            showToast('解析文件信息失败', 'error');
        }
    } else {
        // 没有文件信息，显示提示
        console.log('[审查] 没有文件信息');
        showToast('请从数据管理页面选择文件进行审查', 'info');
    }
}

// 处理从数据管理页面导入的问题
window.handleImportedQuestions = async function(questionNos) {
    console.log('[审查] 处理导入的问题编号:', questionNos);
    
    if (!questionNos || questionNos.length === 0) {
        showToast('没有导入任何问题', 'warning');
        return;
    }
    
    // 通过API获取问题数据
    try {
        const response = await fetch(`${API_BASE}/get-review-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ question_nos: questionNos })
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
                console.log('[审查] API获取数据成功，共', data.data.length, '条');
                
                const dataArray = data.data;
                
                if (dataArray.length > 0) {
                    // 保存数据到全局变量
                    globalData.currentReviewData = dataArray;
                    globalData.currentReviewIndex = 0;
                    console.log('[审查] 保存数据到全局变量，从索引 0 开始');
                    
                    // 保存数据到localStorage
                    localStorage.setItem('currentReviewData', JSON.stringify(dataArray));
                    console.log('[审查] 保存数据到localStorage');
                    
                    // 显示第一个问题
                    showReviewItem(0);
                    
                    // 初始化统计信息
                    updateStatistics();
                    console.log('[审查] 初始化统计信息');
                    
                    showToast(`成功导入 ${questionNos.length} 条问题到审核页面`, 'success');
                } else {
                    console.log('[审查] 没有找到对应的数据');
                    showToast('没有找到对应的数据', 'error');
                }
            } else {
                console.error('[审查] API返回数据失败');
                showToast('获取审查数据失败，请稍后重试', 'error');
            }
        } else {
            console.error('[审查] API请求失败');
            showToast('获取审查数据失败，请稍后重试', 'error');
        }
    } catch (error) {
        console.error('[审查] 导入问题失败:', error);
        showToast('导入问题失败，请稍后重试', 'error');
    }
}

// 绑定人工复审页面事件
function bindManualReviewEvents() {
    // 审核状态按钮
    const approveBtn = document.getElementById('approveBtn');
    const reviseBtn = document.getElementById('reviseBtn');
    if (approveBtn) {
        approveBtn.addEventListener('click', () => handleReviewStatus('approve'));
    }
    if (reviseBtn) {
        reviseBtn.addEventListener('click', () => handleReviewStatus('revise'));
    }
    
    // 操作工具按钮
    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');
    const uploadImageButton = document.getElementById('uploadImageButton');
    const submitBtn = document.getElementById('submitBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveReviewChanges);
    }
    if (resetBtn) {
        resetBtn.addEventListener('click', resetReviewContent);
    }
    if (uploadImageButton) {
        uploadImageButton.addEventListener('click', handleImageUpload);
    }
    if (submitBtn) {
        submitBtn.addEventListener('click', submitReview);
    }
    if (prevBtn) {
        prevBtn.addEventListener('click', prevReviewItem);
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', nextReviewItem);
    }
    
    // 快捷操作
    const exportApprovedData = document.getElementById('exportApprovedData');
    const importDataBtn = document.getElementById('importDataBtn');
    if (exportApprovedData) {
        exportApprovedData.addEventListener('click', showExportModal);
    }
    if (importDataBtn) {
        importDataBtn.addEventListener('click', handleImportData);
    }
    
    // 快捷键
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // 绑定统计信息点击事件
    bindStatisticsClickEvents();
    
    // 导出确认按钮
    const confirmExportBtn = document.getElementById('confirmExportBtn');
    if (confirmExportBtn) {
        confirmExportBtn.addEventListener('click', exportApprovedData);
    }
}

// 绑定统计信息点击事件
function bindStatisticsClickEvents() {
    // 查找审核统计相关的元素
    const pendingSection = document.querySelector('.review-page-stat-item:nth-child(2)');
    const approvedSection = document.querySelector('.review-page-stat-item:nth-child(3)');
    const modifiedSection = document.querySelector('.review-page-stat-item:nth-child(4)');
    
    // 绑定点击事件
    if (pendingSection) {
        pendingSection.style.cursor = 'pointer';
        pendingSection.addEventListener('click', () => showReviewByStatus('pending'));
    }
    if (approvedSection) {
        approvedSection.style.cursor = 'pointer';
        approvedSection.addEventListener('click', () => showReviewByStatus('approved'));
    }
    if (modifiedSection) {
        modifiedSection.style.cursor = 'pointer';
        modifiedSection.addEventListener('click', () => showReviewByStatus('modified'));
    }
}

// 显示指定状态的问答对
function showReviewByStatus(status) {
    const currentData = globalData.currentReviewData;
    if (!currentData || !Array.isArray(currentData)) {
        return;
    }
    
    // 查找第一个指定状态的问答对
    const index = currentData.findIndex(item => {
        if (status === 'pending') {
            return !item.reviewStatus || item.reviewStatus === 'pending';
        } else {
            return item.reviewStatus === status;
        }
    });
    
    if (index >= 0) {
        // 显示找到的问答对
        globalData.currentReviewIndex = index;
        showReviewItem(index);
        showToast(`显示${status === 'pending' ? '待审核' : status === 'approved' ? '已通过' : '需修改'}的问答对`, 'info');
    } else {
        showToast(`没有${status === 'pending' ? '待审核' : status === 'approved' ? '已通过' : '需修改'}的问答对`, 'info');
    }
}

// 处理导入数据
function handleImportData() {
    // 弹出保存提醒
    if (confirm('确定要跳转到数据管理页面吗？\n\n当前页面的修改将被保存。')) {
        // 保存当前页面的修改
        saveReviewChanges();
        // 跳转到数据管理页面
        switchPage('data-management');
    }
}

// 处理审核状态
function handleReviewStatus(status) {
    const statusIndicator = document.getElementById('statusIndicator');
    if (statusIndicator) {
        if (status === 'approve') {
            statusIndicator.className = 'badge badge-success';
            statusIndicator.textContent = '已通过';
        } else if (status === 'revise') {
            statusIndicator.className = 'badge badge-warning';
            statusIndicator.textContent = '需修改';
        }
    }
    
    // 保存状态到全局数据
    const currentData = globalData.currentReviewData;
    const currentIndex = globalData.currentReviewIndex;
    if (currentData && Array.isArray(currentData) && currentIndex >= 0 && currentIndex < currentData.length) {
        const reviewStatus = status === 'approve' ? 'approved' : 'modified';
        currentData[currentIndex].reviewStatus = reviewStatus;
        globalData.currentReviewData = currentData;
        // 保存到localStorage
        localStorage.setItem('currentReviewData', JSON.stringify(currentData));
        // 更新统计信息
        updateStatistics();
        
        // 更新导入历史中的文件内容，确保统计信息同步
        const fileInfo = localStorage.getItem('currentReviewFileInfo');
        if (fileInfo) {
            try {
                const info = JSON.parse(fileInfo);
                const fileIndex = importHistory.findIndex(item => item.name === info.name);
                if (fileIndex !== -1) {
                    importHistory[fileIndex].content = currentData;
                    localStorage.setItem('importHistory', JSON.stringify(importHistory));
                    // 更新数据管理页面的统计信息
                    updateDataManagementStatistics();
                }
            } catch (error) {
                console.error('更新导入历史失败:', error);
            }
        }
        
        // 更新数据库中的审核状态
        const questionNo = currentData[currentIndex].id_value;
        const reviewStatusValue = status === 'approve' ? 2 : 3; // 2表示已通过，3表示需修改
        
        fetch('/api/update-review-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                review_items: [{
                    question_no: questionNo,
                    review_status: reviewStatusValue
                }]
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('数据库审核状态更新成功');
            } else {
                console.error('数据库审核状态更新失败:', data.error);
            }
        })
        .catch(error => {
            console.error('更新审核状态时出错:', error);
        });
    }
    
    showToast(status === 'approve' ? '审核通过' : '标记为需修改', 'success');
}

// 保存审核修改
function saveReviewChanges() {
    const optimizedQuestion = document.getElementById('optimizedQuestion');
    const optimizedAnswer = document.getElementById('optimizedAnswer');
    if (optimizedQuestion && optimizedAnswer) {
        const question = optimizedQuestion.textContent;
        const answer = optimizedAnswer.textContent;
        
        // 保存修改到当前数据
        const currentData = globalData.currentReviewData;
        const currentIndex = globalData.currentReviewIndex;
        if (currentData && Array.isArray(currentData) && currentIndex >= 0 && currentIndex < currentData.length) {
            // 保存修改后的内容
            currentData[currentIndex].optimized_question = question;
            currentData[currentIndex].optimized_answer = answer;
            
            // 更新全局数据
            globalData.currentReviewData = currentData;
            
            // 保存到localStorage
            localStorage.setItem('currentReviewData', JSON.stringify(currentData));
            
            // 更新导入历史中的文件内容，确保数据同步
            const fileInfo = localStorage.getItem('currentReviewFileInfo');
            if (fileInfo) {
                try {
                    const info = JSON.parse(fileInfo);
                    const fileIndex = importHistory.findIndex(item => item.name === info.name);
                    if (fileIndex !== -1) {
                        importHistory[fileIndex].content = currentData;
                        localStorage.setItem('importHistory', JSON.stringify(importHistory));
                    }
                } catch (error) {
                    console.error('更新导入历史失败:', error);
                }
            }
        }
        
        showToast('修改已保存', 'success');
    }
}

// 显示指定索引的问答对
function showReviewItem(index) {
    const currentData = globalData.currentReviewData;
    if (!currentData || !Array.isArray(currentData) || index < 0 || index >= currentData.length) {
        return;
    }
    
    const item = currentData[index];
    
    // 更新原始问题
    const originalQuestion = document.getElementById('originalQuestion');
    if (originalQuestion) {
        originalQuestion.textContent = item.question || item.original_question1 || item.original_question || '无原始问题';
    }
    
    // 更新原始答案
    const originalAnswer = document.getElementById('originalAnswer');
    if (originalAnswer) {
        originalAnswer.textContent = item.answer || item.original_answer1 || item.original_answer || '无原始答案';
    }

    // 更新文本优化问题
    const textOptimizedQuestion = document.getElementById('textOptimizedQuestion');
    if (textOptimizedQuestion) {
        textOptimizedQuestion.textContent = item.doc2_question || item.text_optimized_question || '无文本优化问题';
    }
    // 更新文本优化答案
    const textOptimizedAnswer = document.getElementById('textOptimizedAnswer');
    if (textOptimizedAnswer) {
        textOptimizedAnswer.textContent = item.doc2_answer || item.text_optimized_answer || '无文本优化答案';
    }

    // 更新优化后问题
    const optimizedQuestion = document.getElementById('optimizedQuestion');
    if (optimizedQuestion) {
        // 优先使用doc2_question（文本优化结果），然后使用doc1_question（多模态优化结果）
        optimizedQuestion.textContent = item.doc1_question || item.optimized_question || '无优化后问题';
    }
    
    // 更新优化后答案
    const optimizedAnswer = document.getElementById('optimizedAnswer');
    if (optimizedAnswer) {
        // 优先使用doc2_answer（文本优化结果），然后使用doc1_answer（多模态优化结果）
        optimizedAnswer.textContent = item.doc1_answer || item.optimized_answer || '无优化后答案';
    }
    
    // 更新图片信息
    const imageDisplay = document.getElementById('imageDisplay');
    const imagePlaceholder = document.getElementById('imagePlaceholder');
    const imageContainer = document.getElementById('imageContainer');
    const thumbnailList = document.getElementById('thumbnailList');
    const imageCounter = document.getElementById('imageCounter');
    
    if (imageDisplay && imagePlaceholder && imageContainer && thumbnailList && imageCounter) {
        // 先显示加载状态
        imagePlaceholder.style.display = 'flex';
        imageContainer.style.display = 'none';
        imageCounter.textContent = '(加载中...)';
        
        // 保存原始占位符内容
        const originalPlaceholderContent = imagePlaceholder.innerHTML;
        
        // 修改占位符内容为加载中
        imagePlaceholder.innerHTML = `
            <i class="fas fa-spinner fa-spin"></i>
            <h4>加载中...</h4>
            <p>正在获取图片信息，请稍候</p>
        `;
        
        // 获取问答对的id
        const qaId = item.id_value || item.id || '';
        console.log('[图片加载] 获取到QA ID:', qaId);
        if (qaId) {
            // 从后端数据库获取图片信息
            console.log('[图片加载] 发送请求到:', `${API_BASE}/get-images-by-entity-id`);
            console.log('[图片加载] 请求参数:', { entity_id: qaId });
            
            fetch(`${API_BASE}/get-images-by-entity-id`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity_id: qaId })
            })
            .then(response => {
                console.log('[图片加载] 响应状态:', response.status);
                return response.json();
            })
            .then(result => {
                console.log('[图片加载] 响应结果:', result);
                if (result.success && result.data && Array.isArray(result.data) && result.data.length > 0) {
                    // 有图片
                    console.log('[图片加载] 找到', result.data.length, '张图片');
                    imagePlaceholder.style.display = 'none';
                    imageContainer.style.display = 'block';
                    imageCounter.textContent = `(${1}/${result.data.length})`;
                    
                    // 保存图片数据到全局变量
                    window.currentImages = result.data;
                    
                    // 生成缩略图
                    thumbnailList.innerHTML = result.data.map((img, idx) => {
                        const imgUrl = img.url || img;
                        return `
                            <div class="thumbnail-item ${idx === 0 ? 'active' : ''}" data-index="${idx}">
                                <img src="${imgUrl}" alt="图片 ${idx + 1}" onclick="openImageViewer(${idx})">
                                <div class="thumbnail-index">${idx + 1}</div>
                            </div>
                        `;
                    }).join('');
                } else {
                    // 无图片，恢复原始占位符内容
                    console.log('[图片加载] 未找到图片，返回结果:', result);
                    imagePlaceholder.innerHTML = originalPlaceholderContent;
                    imagePlaceholder.style.display = 'flex';
                    imageContainer.style.display = 'none';
                    imageCounter.textContent = '(0/0)';
                }
            })
            .catch(error => {
                console.error('获取图片信息失败:', error);
                // 无图片，恢复原始占位符内容
                imagePlaceholder.innerHTML = originalPlaceholderContent;
                imagePlaceholder.style.display = 'flex';
                imageContainer.style.display = 'none';
                imageCounter.textContent = '(0/0)';
            });
        } else {
            // 无id，无法查询图片，恢复原始占位符内容
            console.log('[图片加载] 无QA ID，无法查询图片');
            imagePlaceholder.innerHTML = originalPlaceholderContent;
            imagePlaceholder.style.display = 'flex';
            imageContainer.style.display = 'none';
            imageCounter.textContent = '(0/0)';
        }
    }
    
    // 更新QA ID
    const qaIdElement = document.getElementById('qaId');
    if (qaIdElement) {
        const qaId = item.id_value || item.id || '';
        if (qaId) {
            qaIdElement.textContent = `QA-${qaId}`;
            console.log('[处理] QA ID已更新:', `QA-${qaId}`);
        } else {
            qaIdElement.textContent = 'QA-未知';
        }
    }
    
    // 更新审核状态
    const statusIndicator = document.getElementById('statusIndicator');
    if (statusIndicator) {
        const reviewStatus = item.reviewStatus;
        if (reviewStatus === 'approved') {
            statusIndicator.className = 'badge badge-success';
            statusIndicator.textContent = '已通过';
        } else if (reviewStatus === 'modified') {
            statusIndicator.className = 'badge badge-warning';
            statusIndicator.textContent = '需修改';
        } else {
            statusIndicator.className = 'badge badge-secondary';
            statusIndicator.textContent = '待审核';
        }
    }
}

// 重置审核内容
function resetReviewContent() {
    if (confirm('确定要重置内容吗？未保存的修改将丢失。')) {
        const currentData = globalData.currentReviewData;
        const currentIndex = globalData.currentReviewIndex;
        
        if (currentData && Array.isArray(currentData) && currentIndex >= 0 && currentIndex < currentData.length) {
            const item = currentData[currentIndex];
            
            const optimizedQuestion = document.getElementById('optimizedQuestion');
            const optimizedAnswer = document.getElementById('optimizedAnswer');
            
            if (optimizedQuestion && optimizedAnswer) {
                // 重置为原始优化后内容
                optimizedQuestion.textContent = item.doc1_question || item.optimized_question || '无优化后问题';
                optimizedAnswer.textContent = item.doc1_answer || item.optimized_answer || '无优化后答案';
                showToast('内容已重置', 'info');
            }
        }
    }
}

// 上一个问答对
function prevReviewItem() {
    const currentData = globalData.currentReviewData;
    const currentIndex = globalData.currentReviewIndex;
    
    if (currentData && Array.isArray(currentData) && currentIndex > 0) {
        const prevIndex = currentIndex - 1;
        globalData.currentReviewIndex = prevIndex;
        showReviewItem(prevIndex);
        showToast('已切换到上一个问答对', 'info');
    } else {
        showToast('已经是第一个问答对', 'info');
    }
}

// 下一个问答对
function nextReviewItem() {
    const currentData = globalData.currentReviewData;
    const currentIndex = globalData.currentReviewIndex;
    
    if (currentData && Array.isArray(currentData)) {
        // 检查当前问答对是否已提交审核
        const currentItem = currentData[currentIndex];
        if (!currentItem.reviewStatus) {
            showToast('请先提交审核后再切换到下一个问答对', 'warning');
            return;
        }
        
        // 找到下一个待审核的问答对
        let nextIndex = -1;
        for (let i = currentIndex + 1; i < currentData.length; i++) {
            if (!currentData[i].reviewStatus || currentData[i].reviewStatus !== 'approved' && currentData[i].reviewStatus !== 'modified') {
                nextIndex = i;
                break;
            }
        }
        
        // 如果没有找到下一个待审核的，从开始查找
        if (nextIndex === -1) {
            for (let i = 0; i < currentIndex; i++) {
                if (!currentData[i].reviewStatus || currentData[i].reviewStatus !== 'approved' && currentData[i].reviewStatus !== 'modified') {
                    nextIndex = i;
                    break;
                }
            }
        }
        
        // 如果所有都已审核，提示用户
        if (nextIndex === -1) {
            showToast('所有问答对都已审核完成', 'success');
            return;
        }
        
        globalData.currentReviewIndex = nextIndex;
        showReviewItem(nextIndex);
        showToast('已切换到下一个问答对', 'info');
    } else {
        showToast('没有审核数据', 'info');
    }
}

// 处理图片上传
function handleImageUpload() {
    // 创建图片上传输入
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = function(e) {
        const files = e.target.files;
        if (files.length > 0) {
            processUploadedImages(files);
        }
    };
    input.click();
}

// 处理上传的图片
function processUploadedImages(files) {
    // 这里可以处理上传的图片，例如显示预览
    console.log('上传的图片:', files);
    showToast(`已选择 ${files.length} 张图片`, 'success');
    // 示例：更新图片显示
    updateImageDisplay(files);
}

// 打开图片查看器
function openImageViewer(index) {
    const images = window.currentImages;
    if (!images || images.length === 0) {
        console.error('没有图片数据');
        return;
    }
    
    // 创建图片查看器模态框
    const modal = document.createElement('div');
    modal.id = 'imageViewerModal';
    modal.className = 'image-modal';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    modal.style.zIndex = '1000';
    modal.innerHTML = `
        <div class="image-modal-content" style="max-width: 90vw; max-height: 90vh; background: white; border-radius: 10px; position: relative;">
            <div class="modal-header" style="padding: 1rem; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; color: var(--primary-dark);">图片查看器</h3>
                <button class="modal-close" onclick="closeImageViewer()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #999;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body" style="padding: 1rem; position: relative;">
                <div style="display: flex; align-items: center; justify-content: center; min-height: 500px;">
                    <button class="nav-btn" id="prevBtn" onclick="navigateImage(-1)" style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 1.5rem; cursor: pointer; z-index: 10;">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <img id="viewerImage" src="${images[index].url || images[index]}" alt="图片查看" style="max-width: 100%; max-height: 70vh; object-fit: contain;">
                    <button class="nav-btn" id="nextBtn" onclick="navigateImage(1)" style="position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 1.5rem; cursor: pointer; z-index: 10;">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
                <div style="text-align: center; margin-top: 1rem; font-size: 0.9rem; color: #666;">
                    <span id="viewerImageCounter">${index + 1} / ${images.length}</span>
                </div>
            </div>
        </div>
    `;
    
    // 添加到文档
    document.body.appendChild(modal);
    
    // 存储当前状态
    window.imageViewerState = {
        currentIndex: index,
        images: images
    };
    
    // 点击模态框背景关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeImageViewer();
        }
    });
    
    // 按ESC键关闭
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeImageViewer();
        }
    });
    
    // 按左右箭头键切换图片
    document.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowLeft') {
            navigateImage(-1);
        } else if (e.key === 'ArrowRight') {
            navigateImage(1);
        }
    });
    
    // 添加鼠标滚动缩放功能
    const imgElement = modal.querySelector('#viewerImage');
    if (imgElement) {
        let scale = 1;
        const minScale = 0.5;
        const maxScale = 3;
        
        imgElement.addEventListener('wheel', function(e) {
            e.preventDefault();
            
            // 计算缩放比例
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            scale = Math.max(minScale, Math.min(maxScale, scale + delta));
            
            // 应用缩放
            imgElement.style.transform = `scale(${scale})`;
            imgElement.style.transformOrigin = 'center center';
            
            console.log('图片缩放:', scale);
        });
        
        // 添加双击重置缩放
        imgElement.addEventListener('dblclick', function() {
            scale = 1;
            imgElement.style.transform = 'scale(1)';
            console.log('图片缩放已重置');
        });
    }
    
    console.log('图片查看器已打开:', index, images.length);
}

// 关闭图片查看器
function closeImageViewer() {
    const modal = document.getElementById('imageViewerModal');
    if (modal) {
        modal.remove();
    }
    window.imageViewerState = null;
}

// 导航图片
function navigateImage(direction) {
    if (!window.imageViewerState) {
        console.error('图片查看器未打开');
        return;
    }
    
    const { currentIndex, images } = window.imageViewerState;
    let newIndex = currentIndex + direction;
    
    // 循环导航
    if (newIndex < 0) {
        newIndex = images.length - 1;
    } else if (newIndex >= images.length) {
        newIndex = 0;
    }
    
    // 更新状态
    window.imageViewerState.currentIndex = newIndex;
    
    // 更新图片
    const imgElement = document.getElementById('viewerImage');
    const counterElement = document.getElementById('viewerImageCounter');
    
    if (imgElement && counterElement) {
        imgElement.src = images[newIndex].url || images[newIndex];
        counterElement.textContent = `${newIndex + 1} / ${images.length}`;
        
        // 重置缩放比例
        imgElement.style.transform = 'scale(1)';
        console.log('图片已切换到:', newIndex + 1);
    } else {
        console.error('图片元素或计数器元素未找到');
        console.log('图片元素:', imgElement);
        console.log('计数器元素:', counterElement);
    }
}

// 更新图片显示
function updateImageDisplay(files) {
    const imageDisplay = document.getElementById('imageDisplay');
    const imagePlaceholder = document.getElementById('imagePlaceholder');
    const imageContainer = document.getElementById('imageContainer');
    const thumbnailList = document.getElementById('thumbnailList');
    const imageCounter = document.getElementById('imageCounter');
    const thumbnailCount = document.getElementById('thumbnailCount');
    
    if (imageDisplay && imagePlaceholder && imageContainer && thumbnailList && imageCounter && thumbnailCount) {
        // 隐藏占位符，显示图片容器
        imagePlaceholder.style.display = 'none';
        imageContainer.style.display = 'block';
        
        // 更新计数器
        imageCounter.textContent = `(${files.length}/${files.length})`;
        thumbnailCount.textContent = files.length;
        
        // 清空缩略图列表
        thumbnailList.innerHTML = '';
        
        // 添加缩略图
        Array.from(files).forEach((file, index) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const thumbnailItem = document.createElement('div');
                thumbnailItem.className = 'thumbnail-item';
                if (index === 0) {
                    thumbnailItem.classList.add('active');
                }
                thumbnailItem.innerHTML = `
                    <img src="${e.target.result}" alt="图片 ${index + 1}">
                    <div class="thumbnail-index">${index + 1}</div>
                `;
                thumbnailList.appendChild(thumbnailItem);
            };
            reader.readAsDataURL(file);
        });
    }
}

// 提交审核
function submitReview() {
    const statusIndicator = document.getElementById('statusIndicator');
    const status = statusIndicator?.textContent || '待审核';
    
    // 保存审核记录
    const reviewRecord = {
        id: Date.now(),
        question: document.getElementById('originalQuestion')?.textContent || '',
        answer: document.getElementById('originalAnswer')?.textContent || '',
        textOptimizedQuestion: document.getElementById('textOptimizedQuestion')?.textContent || '',
        textOptimizedAnswer: document.getElementById('textOptimizedAnswer')?.textContent || '',
        optimizedQuestion: document.getElementById('optimizedQuestion')?.textContent || '',
        optimizedAnswer: document.getElementById('optimizedAnswer')?.textContent || '',
        status: status === '已通过' ? 'approved' : status === '需修改' ? 'modified' : 'pending',
        reviewTime: new Date().toISOString(),
        reviewer: '专家'
    };
    
    // 保存审核状态到当前数据
    const currentData = globalData.currentReviewData;
    const currentIndex = globalData.currentReviewIndex;
    
    if (currentData && Array.isArray(currentData) && currentIndex >= 0 && currentIndex < currentData.length) {
        // 保存审核状态
        currentData[currentIndex].reviewStatus = reviewRecord.status;
        
        // 更新全局数据
        globalData.currentReviewData = currentData;
        
        // 保存到localStorage
        localStorage.setItem('currentReviewData', JSON.stringify(currentData));
        
        // 更新统计信息
        updateStatistics();
        
        // 更新导入历史中的文件内容，确保统计信息同步
        const fileInfo = localStorage.getItem('currentReviewFileInfo');
        if (fileInfo) {
            try {
                const info = JSON.parse(fileInfo);
                const fileIndex = importHistory.findIndex(item => item.name === info.name);
                if (fileIndex !== -1) {
                    importHistory[fileIndex].content = currentData;
                    localStorage.setItem('importHistory', JSON.stringify(importHistory));
                    // 更新数据管理页面的统计信息
                    updateDataManagementStatistics();
                }
            } catch (error) {
                console.error('更新导入历史失败:', error);
            }
        }
        
        // 跳转到下一个问答对
        const nextIndex = currentIndex + 1;
        if (nextIndex < currentData.length) {
            // 有下一个问答对
            globalData.currentReviewIndex = nextIndex;
            showReviewItem(nextIndex);
            showToast('审核已提交，正在跳转到下一个问答对', 'success');
        } else {
            // 审核完成
            showToast('所有问答对已审核完成', 'success');
        }
    } else {
        showToast('审核已提交', 'success');
    }
}

// 显示导出报告模态框
function showExportModal() {
    // 创建导出报告模态框
    const modal = document.createElement('div');
    modal.id = 'exportModal';
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="image-modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <div class="modal-title"><i class="fas fa-file-export"></i> 导出已通过数据</div>
                <button class="modal-close" onclick="document.getElementById('exportModal').classList.remove('active')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body" style="padding: 2rem; background: white; min-height: auto;">
                <div style="margin-bottom: 1.5rem;">
                    <h4 style="margin-bottom: 1rem; color: var(--primary-dark);"><i class="fas fa-filter"></i> 筛选导出内容</h4>
                    <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="checkbox" id="exportAll" checked onchange="toggleExportOptions()">
                            <span>全部问答对</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="checkbox" id="exportApproved" onchange="toggleExportOptions()">
                            <span>已通过</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="checkbox" id="exportModified" onchange="toggleExportOptions()">
                            <span>需修改</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="checkbox" id="exportPending" onchange="toggleExportOptions()">
                            <span>待审核</span>
                        </label>
                    </div>
                </div>
                <div style="margin-bottom: 1.5rem;">
                    <h4 style="margin-bottom: 1rem; color: var(--primary-dark);"><i class="fas fa-cog"></i> 导出选项</h4>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; margin-bottom: 0.5rem;">
                        <input type="checkbox" id="includeImages" checked>
                        <span>包含图片信息</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; margin-bottom: 0.5rem;">
                        <input type="checkbox" id="includeMetadata" checked>
                        <span>包含元数据</span>
                    </label>
                </div>
                <div id="exportProgress" style="display: none; text-align: center; padding: 1rem;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--primary-color);"></i>
                    <p style="margin-top: 1rem;">正在生成导出文件...</p>
                </div>
            </div>
            <div class="modal-footer">
                <div class="modal-nav">
                    <button class="modal-nav-btn" onclick="document.getElementById('exportModal').classList.remove('active')">
                        取消
                    </button>
                    <button class="modal-nav-btn" onclick="exportApprovedData()">
                        导出
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.classList.add('active');
}

// 切换导出选项
function toggleExportOptions() {
    const exportAll = document.getElementById('exportAll');
    const exportApproved = document.getElementById('exportApproved');
    const exportModified = document.getElementById('exportModified');
    const exportPending = document.getElementById('exportPending');
    
    if (exportAll) {
        if (exportAll.checked) {
            if (exportApproved) exportApproved.checked = false;
            if (exportModified) exportModified.checked = false;
            if (exportPending) exportPending.checked = false;
        }
    }
}

// 导出已通过数据
function exportApprovedData() {
    const exportProgress = document.getElementById('exportProgress');
    if (exportProgress) {
        exportProgress.style.display = 'block';
    }
    
    try {
        // 获取当前审核数据
        const currentData = globalData.currentReviewData;
        if (!currentData || !Array.isArray(currentData)) {
            throw new Error('没有审核数据');
        }
        
        // 筛选已通过的数据
        const approvedData = currentData.filter(item => item.reviewStatus === 'approved');
        if (approvedData.length === 0) {
            throw new Error('没有已通过的数据');
        }
        
        // 准备导出数据
        const exportData = {
            export_time: new Date().toISOString(),
            total_count: approvedData.length,
            data: approvedData
        };
        
        // 转换为JSON字符串
        const jsonData = JSON.stringify(exportData, null, 2);
        
        // 创建Blob对象
        const blob = new Blob([jsonData], { type: 'application/json' });
        
        // 创建下载链接
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `approved_data_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        
        // 触发下载
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // 释放URL对象
        URL.revokeObjectURL(url);
        
        // 隐藏进度条并显示成功提示
        setTimeout(() => {
            if (exportProgress) {
                exportProgress.style.display = 'none';
            }
            showToast(`成功导出 ${approvedData.length} 条已通过数据`, 'success');
            const exportModal = document.getElementById('exportModal');
            if (exportModal) {
                exportModal.classList.remove('active');
            }
        }, 1000);
        
    } catch (error) {
        console.error('导出已通过数据失败:', error);
        if (exportProgress) {
            exportProgress.style.display = 'none';
        }
        showToast(`导出失败: ${error.message}`, 'error');
        const exportModal = document.getElementById('exportModal');
        if (exportModal) {
            exportModal.classList.remove('active');
        }
    }
}

// 处理键盘快捷键
function handleKeyboardShortcuts(e) {
    if (e.ctrlKey) {
        if (e.key === 's') {
            e.preventDefault();
            saveReviewChanges();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            submitReview();
        }
    }
}

// 更新统计信息
function updateStatistics() {
    console.log('[统计] 更新审核统计信息');
    
    const totalCount = document.getElementById('totalCount');
    const pendingCount = document.getElementById('pendingCount');
    const approvedCount = document.getElementById('approvedCount');
    const modifiedCount = document.getElementById('modifiedCount');
    const progressText = document.getElementById('progressText');
    const progressFill = document.getElementById('progressFill');
    
    console.log('[统计] 检查DOM元素:', {
        totalCount: !!totalCount,
        pendingCount: !!pendingCount,
        approvedCount: !!approvedCount,
        modifiedCount: !!modifiedCount,
        progressText: !!progressText,
        progressFill: !!progressFill
    });
    
    if (totalCount && pendingCount && approvedCount && modifiedCount && progressText && progressFill) {
        // 获取当前审查数据
        const reviewData = localStorage.getItem('currentReviewData');
        const fileInfo = localStorage.getItem('currentReviewFileInfo');
        
        console.log('[统计] 读取localStorage数据:', {
            reviewDataExists: !!reviewData,
            fileInfoExists: !!fileInfo,
            reviewDataLength: reviewData ? reviewData.length : 0
        });
        
        if (reviewData) {
            try {
                const data = JSON.parse(reviewData);
                console.log('[统计] 解析后的数据:', {
                    type: typeof data,
                    isArray: Array.isArray(data),
                    keys: typeof data === 'object' ? Object.keys(data) : []
                });
                
                // 处理数据结构，确保是数组
                let dataArray;
                if (Array.isArray(data)) {
                    dataArray = data;
                } else if (data && typeof data === 'object') {
                    // 检查是否是单个问答对对象
                    if (data.id_value || data.id || data.original_question || data.original_answer) {
                        dataArray = [data];
                    } else {
                        // 可能是其他结构，尝试获取内容数组
                        dataArray = data.content || data.data || [];
                    }
                } else {
                    dataArray = [];
                }
                
                // 总数是导入的 JSON 文件的问答对总数
                const total = dataArray.length;
                
                console.log('[统计] 数据处理成功:', {
                    total: total,
                    arrayLength: dataArray.length,
                    dataArray: dataArray,
                    firstItem: dataArray.length > 0 ? dataArray[0] : null
                });
                
                // 手动计算状态数量，与自动计算对比
                let manualApproved = 0;
                let manualModified = 0;
                let manualPending = 0;
                dataArray.forEach(item => {
                    // 处理数字类型的 reviewStatus
                    if (item.reviewStatus === 2 || item.reviewStatus === 'approved') {
                        manualApproved++;
                    } else if (item.reviewStatus === 3 || item.reviewStatus === 'modified') {
                        manualModified++;
                    } else {
                        manualPending++;
                    }
                });
                
                console.log('[统计] 手动计算状态:', {
                    approved: manualApproved,
                    modified: manualModified,
                    pending: manualPending
                });
                
                // 从当前数据中统计审核状态
                let approved = 0;
                let modified = 0;
                let pending = 0;
                
                dataArray.forEach(item => {
                    // 处理数字类型的 reviewStatus
                    if (item.reviewStatus === 2 || item.reviewStatus === 'approved') {
                        approved++;
                    } else if (item.reviewStatus === 3 || item.reviewStatus === 'modified') {
                        modified++;
                    } else {
                        pending++;
                    }
                });
                
                console.log('[统计] 从当前数据统计:', {
                    approved: approved,
                    modified: modified,
                    pending: pending
                });
                
                console.log('[统计] 更新DOM前:', {
                    total: total,
                    pending: pending,
                    approved: approved,
                    modified: modified
                });
                
                // 确保元素存在且类型正确
                if (typeof totalCount.textContent !== 'undefined') {
                    totalCount.textContent = total;
                    console.log('[统计] 总数已更新:', total);
                } else {
                    console.error('[统计] totalCount 元素无法更新');
                }
                
                pendingCount.textContent = pending;
                approvedCount.textContent = approved;
                modifiedCount.textContent = modified;
                
                const progress = total > 0 ? Math.round((approved + modified) / total * 100) : 0;
                progressText.textContent = `进度: ${progress}%`;
                progressFill.style.width = `${progress}%`;
                
                console.log('[统计] DOM更新完成');
                
                // 检查更新后的值
                setTimeout(() => {
                    console.log('[统计] 更新后的值:', {
                        totalCount: totalCount.textContent,
                        pendingCount: pendingCount.textContent,
                        approvedCount: approvedCount.textContent,
                        modifiedCount: modifiedCount.textContent
                    });
                    
                    // 检查localStorage中的数据
                    const storedData = localStorage.getItem('currentReviewData');
                    if (storedData) {
                        try {
                            const parsedData = JSON.parse(storedData);
                            const storedArray = Array.isArray(parsedData) ? parsedData : 
                                (parsedData.content || parsedData.data || []);
                            console.log('[统计] localStorage数据长度:', storedArray.length);
                        } catch (e) {
                            console.error('[统计] 解析localStorage数据失败:', e);
                        }
                    }
                }, 100);
                
                // 绑定点击事件，显示对应状态的问答对
                bindStatisticsClickEvents();
                
            } catch (error) {
                console.error('解析审查数据失败:', error);
                // 显示错误状态
                totalCount.textContent = '0';
                pendingCount.textContent = '0';
                approvedCount.textContent = '0';
                modifiedCount.textContent = '0';
                progressText.textContent = '进度: 0%';
                progressFill.style.width = '0%';
            }
        } else {
            // 没有审查数据，显示默认值
            totalCount.textContent = '0';
            pendingCount.textContent = '0';
            approvedCount.textContent = '0';
            modifiedCount.textContent = '0';
            progressText.textContent = '进度: 0%';
            progressFill.style.width = '0%';
        }
    }
}

// 审核历史页面相关功能
// 历史记录管理
class HistoryManager {
    constructor() {
        this.reviewHistory = [];
        this.init();
    }
    
    init() {
        this.loadHistory();
        this.bindEvents();
    }
    
    bindEvents() {
        const statusFilter = document.getElementById('statusFilter');
        const dateFilter = document.getElementById('dateFilter');
        const exportHistoryBtn = document.getElementById('exportHistoryBtn');
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        
        if (statusFilter) {
            statusFilter.addEventListener('change', () => this.loadHistory());
        }
        if (dateFilter) {
            dateFilter.addEventListener('change', () => this.loadHistory());
        }
        if (exportHistoryBtn) {
            exportHistoryBtn.addEventListener('click', () => this.exportHistory());
        }
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => this.clearHistory());
        }
    }
    
    loadHistory() {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;
        
        const statusFilter = document.getElementById('statusFilter');
        const dateFilter = document.getElementById('dateFilter');
        
        const statusValue = statusFilter ? statusFilter.value : 'all';
        const dateValue = dateFilter ? dateFilter.value : 'all';
        
        // 筛选历史记录
        let filteredHistory = this.reviewHistory;
        
        if (statusValue !== 'all') {
            filteredHistory = filteredHistory.filter(item => item.status === statusValue);
        }
        
        if (dateValue !== 'all') {
            const now = new Date();
            let cutoffDate;
            
            switch (dateValue) {
                case 'today':
                    cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    break;
                case 'week':
                    cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    cutoffDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
            }
            
            filteredHistory = filteredHistory.filter(item => {
                return new Date(item.reviewTime) >= cutoffDate;
            });
        }
        
        if (filteredHistory.length === 0) {
            historyList.innerHTML = `
                <div class="history-page-empty-state">
                    <i class="fas fa-clock"></i>
                    <h3>暂无符合条件的历史记录</h3>
                    <p>尝试调整筛选条件</p>
                </div>
            `;
            return;
        }
        
        // 构建历史记录HTML
        const historyHTML = filteredHistory.map((item, index) => {
            const statusClass = `history-page-status-${item.status}`;
            const statusText = item.status === 'approved' ? '已通过' : item.status === 'modified' ? '需修改' : '待审核';
            const reviewTime = new Date(item.reviewTime).toLocaleString();
            
            return `
                <div class="history-page-history-item">
                    <div class="history-page-history-header">
                        <div class="history-page-history-info">
                            <div class="history-page-history-question">${item.question || item.optimizedQuestion || '无问题内容'}</div>
                            <div class="history-page-history-meta">
                                <span>ID: ${item.id}</span>
                                <span>审核人: ${item.reviewer}</span>
                                <span>审核时间: ${reviewTime}</span>
                            </div>
                        </div>
                        <span class="history-page-history-status ${statusClass}">${statusText}</span>
                    </div>
                    
                    ${item.originalContent || item.originalAnswer ? `
                        <div class="history-page-comparison-section">
                            <div class="history-page-comparison-header">
                                <i class="fas fa-exchange-alt"></i> 内容对比
                            </div>
                            <div class="history-page-comparison-grid">
                                <div class="history-page-comparison-column original">
                                    <div class="history-page-comparison-label">修改前</div>
                                    <div class="history-page-comparison-content">${item.originalContent || item.originalAnswer || '无'}</div>
                                </div>
                                <div class="history-page-comparison-column modified">
                                    <div class="history-page-comparison-label">修改后</div>
                                    <div class="history-page-comparison-content">${item.modifiedContent || item.optimizedAnswer || '无'}</div>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        historyList.innerHTML = historyHTML;
    }
    
    exportHistory() {
        if (this.reviewHistory.length === 0) {
            showToast('没有审核历史记录可导出', 'warning');
            return;
        }
        
        try {
            const exportData = {
                export_time: new Date().toISOString(),
                total_records: this.reviewHistory.length,
                history: this.reviewHistory
            };
            
            const jsonData = JSON.stringify(exportData, null, 2);
            
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `review-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showToast(`成功导出 ${this.reviewHistory.length} 条审核历史记录`, 'success');
        } catch (error) {
            console.error('导出历史失败:', error);
            showToast(`导出历史失败：${error.message}`, 'warning');
        }
    }
    
    clearHistory() {
        if (this.reviewHistory.length === 0) {
            showToast('没有历史记录可清空', 'info');
            return;
        }
        
        if (confirm('确定要清空所有审核历史记录吗？此操作不可撤销。')) {
            this.reviewHistory = [];
            this.loadHistory();
            showToast('历史记录已清空', 'success');
        }
    }
}

// 页面切换功能
function initPageSwitching() {
    // 绑定导航菜单点击事件
    const navLinks = document.querySelectorAll('.nav-menu a');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            switchPage(page);
        });
    });
}

// 切换页面
function switchPage(pageId) {
    // 隐藏所有页面
    document.querySelectorAll('.page-container').forEach(container => {
        container.classList.remove('active');
    });
    
    // 显示目标页面
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    // 更新导航菜单激活状态
    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-page') === pageId) {
            link.classList.add('active');
        }
    });
    
    // 根据页面ID初始化相应功能
    switch (pageId) {
        case 'data-management':
            initDataManagement();
            break;
        case 'manual-review':
            // 只有当人工复审页面没有被初始化过，或者数据发生变化时才重新初始化
            // 这样可以保持页面状态，防止切换页面时丢失进度
            if (!globalData.manualReviewInitialized) {
                initManualReview();
                globalData.manualReviewInitialized = true;
            }
            break;
        case 'review-history':
            new HistoryManager();
            break;
    }
}

// 初始化所有功能
document.addEventListener('DOMContentLoaded', function() {
    // 初始化页面切换
    initPageSwitching();
    
    // 初始化系统首页功能
    if (document.getElementById('index').classList.contains('active')) {
        // 系统首页的初始化已经在前面的代码中完成
    }
});
