# DeepSeek 标签捕手 (DeepSeek Tag Catcher)

一款本地优先的浏览器扩展（Edge / Chrome），用于在 DeepSeek 网页版中划词记录重要信息，（无法提供跨分支的精准定位功能）。

## 功能特性
- ✨ **划词打标**：在任意对话中划选文字，一键添加标签。
- 🚀 **精准定位**：点击标签，自动遍历 DeepSeek 的对话树，滚动并高亮目标文字。
- ✏️ **标签管理**：支持对标签进行编辑、删除、拖拽排序。
- 💾 **本地存储**：数据通过 `chrome.storage.local` 保存在本地，安全可靠，支持导出/导入 JSON 备份。

## 安装方法（开发者模式）
1. 点击页面右上角的 `Code` -> `Download ZIP`，解压到本地。
2. 在 Edge 或 Chrome 浏览器地址栏输入 `edge://extensions/` 或 `chrome://extensions/`。
3. 打开右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择解压后的文件夹即可。

## 开发技术栈
- 原生 JavaScript (Manifest V3)
- Chrome Extension APIs (Storage, Tabs)
