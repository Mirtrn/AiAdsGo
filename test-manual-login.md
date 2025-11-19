# 手动登录测试步骤

## 测试配置
- URL: http://localhost:3000
- 用户名: autoads
- 密码: ***REMOVED***

## 测试步骤

### 1. 访问登录页
- 打开浏览器（Chrome/Edge）
- 访问 http://localhost:3000/login
- 清除浏览器缓存（Cmd+Shift+Delete）或使用无痕模式

### 2. 填写凭证
- 在用户名框输入：autoads
- 在密码框输入：***REMOVED***
- 点击"立即登录"按钮

### 3. 验证登录结果
- ✅ 应该跳转到 /dashboard
- ✅ 右上角显示 "autoads" + "Admin"
- ✅ 显示欢迎消息："欢迎回来, autoads! 👋"
- ✅ Dashboard 加载完整

### 4. 如果出现错误
- 按 F12 打开开发者工具
- 查看 Console 标签页的错误信息
- 查看 Network 标签页，确认 API 调用状态
- 截图错误信息

## 已知问题
- Dashboard 可能显示"正在加载仪表盘..."然后卡住
- 如果出现此问题，查看浏览器控制台错误

## 后端验证
服务器应该显示以下日志：
```
SELECT * FROM users WHERE username = 'autoads' OR email = 'autoads'
UPDATE users SET last_login_at = datetime('now') WHERE id = 6.0
```

## Cookie 验证
在开发者工具 → Application → Cookies → http://localhost:3000
应该看到：
- `auth_token` = [JWT token]
- HttpOnly: ✅
- Secure: (开发环境可能是 ❌)
- SameSite: Lax
