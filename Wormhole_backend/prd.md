## FastAPI后端 虫洞私密共享空间

### 基本功能
- 打开首页就是一个数字键盘，输入6位空间号，点击确定，进入共享空间
- 共享空间内，有几个功能：聊天、笔记、钱包、设置

### 具体功能
- 聊天：可以发送消息，和空间内的人聊天
- 笔记：可以创建笔记，编辑笔记，空间内的人是同步可见的
- 钱包：可以查看钱包余额，充值，付款，空间内的人是共享的
- 设置：可以修改空间号，删除空间，分享空间

### 保密性
- 空间号是6位数字，输入任意空间号，都会进入一个 新空间/已有空间，没有任何“空间不存在”的提示；
- 分享空间时，会生成一个口令，他人复制口令，再打开小程序，可以进入该空间，且必须为该口令指定一个空间号，否则无法进入。
- 也就是说，同一个共享空间，对于不同的人，使用的是不同的空间号。
- 每个用户的空间号是唯一的，且不重复的。

### 软件界面
整体风格，简洁、现代、配色活泼。
- 首页：输入空间号，进入共享空间
- 共享空间：四个选项，聊天、笔记、钱包、设置
- 聊天：是一个聊天框页面，可以发送消息
- 笔记：笔记列表，可以点击查看，编辑，删除；下面中间有一个+号，可以创建新笔记
- 钱包：可以查看钱包余额，充值，点击查看付款码。
- 设置：可以修改空间号，删除空间，分享空间（创建分享口令）

### 技术实现
- 前端：微信小程序
- 后端：python fastapi
- 数据库：sqlite
- 储存：腾讯云COS

### 后端API

1. 空间
1.1 进入空间
    说明：任何数字都能进入，如果空间不存在，则返回空数据；如果空间存在，则返回空间信息。
    POST /api/space/enter
    请求参数：
    - spaceCode: 6位数字空间号
    返回：
    - success: 是否成功
    - message: 提示信息

1.2 创建空间
    说明：不单独提供创建空间的API，在用户向新空间发送第一条消息、创建笔记、创建钱包时，自动创建空间。
    POST /api/space/create
    请求参数：
    - spaceCode: 6位数字空间号
    返回：
    - success: 是否成功
    - message: 提示信息

2. 聊天
2.1 聊天-获取聊天记录
    POST /api/chat/history
    请求参数：
    - spaceId: 空间ID
    返回：
    - messages: 聊天记录
    - lastMessageId: 最后一条消息ID

3. 笔记
3.1 笔记-获取笔记列表
    POST /api/notes
    请求参数：
    - spaceId: 空间ID
    - userId: 用户ID（可选，用于判断是否已点赞）
    返回：
    - notes: 笔记列表（含点赞头像列表 likes）
3.2 评论-删除
    POST /api/feed/comment/delete
    请求参数：
    - comment_id: 评论ID
    - operator_user_id: 操作者 user_id（评论作者或房主）
    返回：
    - success: 是否成功
3.3 笔记-点赞/取消
    POST /api/feed/like
    请求参数：
    - post_id: 动态ID
    - user_id: 用户ID
    - like: 是否点赞（true 点赞，false 取消）
    返回：
    - like_count: 当前点赞数
    - liked: 当前点赞状态

4. 钱包
4.1 钱包-获取钱包信息
    POST /api/wallet/info
    请求参数：
    - spaceId: 空间ID
    返回：
    - balance: 钱包余额
    - payCodeUrl: 付款码URL

4.2 钱包-获取交易记录
    POST /api/wallet/transactions
    请求参数：
    - spaceId: 空间ID
    返回：
    - transactions: 交易记录

5. 设置
5.1 设置-修改空间号
    POST /api/space/modify-code
    请求参数：
    - spaceId: 空间ID
    - newCode: 新空间号
    返回：
    - success: 是否成功
    - message: 提示信息

5.2 设置-分享空间
    POST /api/space/share
    请求参数：
    - spaceId: 空间ID
    - operator_user_id: 操作者 user_id（必须为房主）
    返回：
    - shareCode: 分享口令（5分钟有效，单次使用）

5.3 设置-删除空间
    POST /api/space/delete
    请求参数：
    - spaceId: 空间ID
    返回：
    - success: 是否成功
    - message: 提示信息
