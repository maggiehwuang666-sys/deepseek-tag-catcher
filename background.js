// 监听扩展图标点击
chrome.action.onClicked.addListener((tab) => {
  // 检查是否已经打开了面板窗口（避免重复打开）
  chrome.windows.getAll({ populate: true }, (windows) => {
    const existingWindow = windows.find(w => w.type === 'popup' && w.title === 'DeepSeek 标签捕手');
    
    if (existingWindow) {
      // 如果已经打开了，就把它聚焦到前面
      chrome.windows.update(existingWindow.id, { focused: true });
    } else {
      // 如果没打开，计算位置并创建一个新的独立窗口
      const popupWidth = 400;
      const popupHeight = 600;
      
      // 获取当前激活的浏览器窗口
      chrome.windows.getLastFocused({ windowTypes: ['normal'] }, (currentWindow) => {
        let left = 100; // 默认兜底左侧位置
        let top = 100;  // 默认兜底顶部位置
        
        if (currentWindow && currentWindow.width) {
          // 计算右上角坐标：当前窗口左边距 + 宽度 - 弹窗宽度 - 距右侧的边距
          left = currentWindow.left + currentWindow.width - popupWidth - 20; // 距离右侧 20px
          // 计算顶部坐标：当前窗口顶部 + 距顶部的边距（避开浏览器的地址栏区域）
          top = currentWindow.top + 80; 
        }
        
        chrome.windows.create({
          url: chrome.runtime.getURL('popup.html'),
          type: 'popup',
          width: popupWidth,
          height: popupHeight,
          left: Math.round(left),
          top: Math.round(top)
        });
      });
    }
  });
});