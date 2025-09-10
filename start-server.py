#!/usr/bin/env python3
"""
간단한 HTTP 서버 실행 스크립트
MEMORY 주점 주문 시스템 테스트용
"""

import http.server
import socketserver
import webbrowser
import os
import sys

# 서버 설정
PORT = 8000
HANDLER = http.server.SimpleHTTPRequestHandler

# public/order-system 디렉토리로 이동
os.chdir('public/order-system')

print(f"""
🏟️ MEMORY 주점 서버 시작! ⚾

📍 서버 주소: http://localhost:{PORT}
📋 주문 페이지: http://localhost:{PORT}/index.html  
👨‍💼 관리자 페이지: http://localhost:{PORT}/admin.html
🕒 대기 순번 예시: http://localhost:{PORT}/waiting.html?orderId=test

서버를 중지하려면 Ctrl+C를 누르세요.
""")

try:
    with socketserver.TCPServer(("", PORT), HANDLER) as httpd:
        print(f"서버가 포트 {PORT}에서 실행 중...")
        
        # 자동으로 브라우저 열기
        webbrowser.open(f'http://localhost:{PORT}/index.html')
        
        httpd.serve_forever()
        
except KeyboardInterrupt:
    print("\n⚾ 서버를 종료합니다. 감사합니다!")
    sys.exit(0)
except OSError as e:
    if e.errno == 48:  # Address already in use
        print(f"❌ 포트 {PORT}이 이미 사용 중입니다.")
        print(f"다른 터미널에서 다음 명령어로 프로세스를 종료하세요:")
        print(f"lsof -ti:{PORT} | xargs kill -9")
    else:
        print(f"❌ 서버 시작 오류: {e}")
    sys.exit(1)