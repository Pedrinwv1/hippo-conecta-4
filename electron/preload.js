const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('hippoDesktop', Object.freeze({ platform: process.platform, isDesktop: true }));
