# DeepSeek 标签捕手 (DeepSeek Tag Catcher)

一款本地优先的浏览器扩展（Edge / Chrome），用于在 DeepSeek 网页版中划词记录重要信息。

## 功能特性
- ✨ **划词打标**：在任意对话中划选文字，一键添加标签。
- ✏️ **标签管理**：支持对标签进行编辑、删除、拖拽排序。
- 💾 **本地存储**：数据通过 `chrome.storage.local` 保存在本地，安全可靠，支持导出/导入 JSON 备份。
- 📓 **数据日志**：查看自己都干了什么。

## 安装方法（开发者模式）
1. 点击页面右上角的 `Code` -> `Download ZIP`，解压到本地。
2. 在 Edge 或 Chrome 浏览器地址栏输入 `edge://extensions/` 或 `chrome://extensions/`。
3. 打开右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择解压后的文件夹即可。

## 开发技术栈
- 原生 JavaScript (Manifest V3)
- Chrome Extension APIs (Storage, Tabs)

## 局限说明
1. **自助定位原文**：点击复制原文，自助搜索。
