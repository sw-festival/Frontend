// 토큰 보관/주입 유틸
export const Tokens = {
  setAdmin(t){ try{localStorage.setItem('admin_jwt', t);}catch{} },
  getAdmin(){ try{return localStorage.getItem('admin_jwt')||'';}catch{return ''} },
  clearAdmin(){ try{localStorage.removeItem('admin_jwt');}catch{} },

  // 레거시 호환성 유지 (기본 세션)
  setSession(t){ try{localStorage.setItem('session_token', t);}catch{} },
  getSession(){ try{return localStorage.getItem('session_token')||'';}catch{return ''} },
  clearSession(){ 
    try{
      localStorage.removeItem('session_token');
      localStorage.removeItem('session_meta');
      localStorage.removeItem('session_store');
    }catch{} 
  },

  // 레거시 메타데이터 (하위 호환성)
  setSessionMeta(meta){ 
    try{
      localStorage.setItem('session_meta', JSON.stringify(meta));
    }catch{} 
  },
  getSessionMeta(){ 
    try{
      const stored = localStorage.getItem('session_meta');
      return stored ? JSON.parse(stored) : null;
    }catch{
      return null;
    } 
  },
};

// 새로운 SessionStore (slug별 세션 관리)
export const SessionStore = {
  // slug별 세션 저장
  setSession(slug, sessionData) {
    try {
      const store = this.getStore();
      const expiresAt = sessionData.abs_ttl_min 
        ? new Date(Date.now() + sessionData.abs_ttl_min * 60 * 1000).toISOString()
        : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 기본 2시간

      store[slug] = {
        token: sessionData.session_token,
        session_id: sessionData.session_id,
        table_id: sessionData.table?.id || sessionData.table_id,
        channel: sessionData.channel,
        slug: slug,
        expiresAt: expiresAt,
        createdAt: new Date().toISOString()
      };
      
      localStorage.setItem('session_store', JSON.stringify(store));
      console.log(`[SessionStore] 세션 저장: ${slug}`, store[slug]);
    } catch (e) {
      console.error('[SessionStore] 세션 저장 실패:', e);
    }
  },

  // slug별 세션 조회
  getSession(slug) {
    try {
      const store = this.getStore();
      const session = store[slug];
      if (!session) return null;

      // 만료 체크
      if (new Date(session.expiresAt) <= new Date()) {
        console.log(`[SessionStore] 세션 만료: ${slug}`);
        this.removeSession(slug);
        return null;
      }

      return session;
    } catch (e) {
      console.error('[SessionStore] 세션 조회 실패:', e);
      return null;
    }
  },

  // slug별 세션 삭제
  removeSession(slug) {
    try {
      const store = this.getStore();
      delete store[slug];
      localStorage.setItem('session_store', JSON.stringify(store));
      console.log(`[SessionStore] 세션 삭제: ${slug}`);
    } catch (e) {
      console.error('[SessionStore] 세션 삭제 실패:', e);
    }
  },

  // 전체 스토어 조회
  getStore() {
    try {
      const stored = localStorage.getItem('session_store');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      console.error('[SessionStore] 스토어 조회 실패:', e);
      return {};
    }
  },

  // 전체 세션 삭제
  clearAll() {
    try {
      localStorage.removeItem('session_store');
      console.log('[SessionStore] 모든 세션 삭제');
    } catch (e) {
      console.error('[SessionStore] 전체 삭제 실패:', e);
    }
  }
};
