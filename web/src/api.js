import axios from 'axios';
const BASE = '/api';

export const login = (username, password) => axios.post(`${BASE}/login`, { username, password });

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 菜单相关API
export const getMenus = () => axios.get(`${BASE}/menus`);
export const addMenu = (data) => axios.post(`${BASE}/menus`, data, { headers: authHeaders() });
export const updateMenu = (id, data) => axios.put(`${BASE}/menus/${id}`, data, { headers: authHeaders() });
export const deleteMenu = (id) => axios.delete(`${BASE}/menus/${id}`, { headers: authHeaders() });

// 子菜单相关API
export const getSubMenus = (menuId) => axios.get(`${BASE}/menus/${menuId}/submenus`);
export const addSubMenu = (menuId, data) => axios.post(`${BASE}/menus/${menuId}/submenus`, data, { headers: authHeaders() });
export const updateSubMenu = (id, data) => axios.put(`${BASE}/menus/submenus/${id}`, data, { headers: authHeaders() });
export const deleteSubMenu = (id) => axios.delete(`${BASE}/menus/submenus/${id}`, { headers: authHeaders() });

// 卡片相关API
export const getCards = (menuId, subMenuId = null) => {
  const params = subMenuId ? { subMenuId } : {};
  return axios.get(`${BASE}/cards/${menuId}`, { params });
};
export const addCard = (data) => axios.post(`${BASE}/cards`, data, { headers: authHeaders() });
export const updateCard = (id, data) => axios.put(`${BASE}/cards/${id}`, data, { headers: authHeaders() });
export const deleteCard = (id) => axios.delete(`${BASE}/cards/${id}`, { headers: authHeaders() });

export const uploadLogo = (file) => {
  const formData = new FormData();
  formData.append('logo', file);
  return axios.post(`${BASE}/upload`, formData, { headers: { ...authHeaders(), 'Content-Type': 'multipart/form-data' } });
};

// 广告API
export const getAds = () => axios.get(`${BASE}/ads`);
export const addAd = (data) => axios.post(`${BASE}/ads`, data, { headers: authHeaders() });
export const updateAd = (id, data) => axios.put(`${BASE}/ads/${id}`, data, { headers: authHeaders() });
export const deleteAd = (id) => axios.delete(`${BASE}/ads/${id}`, { headers: authHeaders() });

// 友链API
export const getFriends = () => axios.get(`${BASE}/friends`);
export const addFriend = (data) => axios.post(`${BASE}/friends`, data, { headers: authHeaders() });
export const updateFriend = (id, data) => axios.put(`${BASE}/friends/${id}`, data, { headers: authHeaders() });
export const deleteFriend = (id) => axios.delete(`${BASE}/friends/${id}`, { headers: authHeaders() });

// 用户API
export const getUserProfile = () => axios.get(`${BASE}/users/profile`, { headers: authHeaders() });
export const changePassword = (oldPassword, newPassword) => axios.put(`${BASE}/users/password`, { oldPassword, newPassword }, { headers: authHeaders() });
export const getUsers = () => axios.get(`${BASE}/users`, { headers: authHeaders() }); 

// ---------- 站点设置（默认主题） ----------
export const getSettings = () => axios.get(`${BASE}/settings`);
export const updateSettings = (data) => axios.put(`${BASE}/settings`, data, { headers: authHeaders() });

// ---------- 数据库管理 ----------
export const getDbStatus = () => axios.get(`${BASE}/db/status`, { headers: authHeaders() });
export const optimizeDb = () => axios.post(`${BASE}/db/maintenance`, { action: 'optimize' }, { headers: authHeaders() });
export const browseTable = (name, params) => axios.get(`${BASE}/db/tables/${name}`, { params, headers: authHeaders() });
export const runQuery = (sql) => axios.post(`${BASE}/db/query`, { sql }, { headers: authHeaders() });

// 导出：返回 Blob，由页面触发浏览器下载
export const exportDb = (params) => axios.get(`${BASE}/db/export`, { params, headers: authHeaders(), responseType: 'blob' });
export const inspectBackup = (backup) => axios.post(`${BASE}/db/inspect`, { backup }, { headers: authHeaders() });
export const importBackup = (backup, options) => axios.post(`${BASE}/db/import`, { backup, options }, { headers: authHeaders() });
export const importFromUrl = (data) => axios.post(`${BASE}/db/import/url`, data, { headers: authHeaders() });

// 远程连接（Supabase / PostgREST）
export const getConnections = () => axios.get(`${BASE}/db/connections`, { headers: authHeaders() });
export const saveConnections = (data) => axios.put(`${BASE}/db/connections`, data, { headers: authHeaders() });
export const getSupabaseSchema = (params) => axios.get(`${BASE}/db/remote/supabase/schema`, { params, headers: authHeaders() });
export const testSupabase = (connection) => axios.post(`${BASE}/db/remote/supabase/test`, { connection }, { headers: authHeaders() });
export const pushSupabase = (connection, options) => axios.post(`${BASE}/db/remote/supabase/push`, { connection, ...options }, { headers: authHeaders() });
export const pullSupabase = (connection, options) => axios.post(`${BASE}/db/remote/supabase/pull`, { connection, options }, { headers: authHeaders() });
