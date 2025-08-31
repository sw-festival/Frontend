// 토큰 보관/주입 유틸
export const Tokens = {
  setAdmin(t){ try{localStorage.setItem('admin_jwt', t);}catch{} },
  getAdmin(){ try{return localStorage.getItem('admin_jwt')||'';}catch{return ''} },
  clearAdmin(){ try{localStorage.removeItem('admin_jwt');}catch{} },

  setSession(t){ try{localStorage.setItem('session_token', t);}catch{} },
  getSession(){ try{return localStorage.getItem('session_token')||'';}catch{return ''} },
  clearSession(){ try{localStorage.removeItem('session_token');}catch{} },
};
