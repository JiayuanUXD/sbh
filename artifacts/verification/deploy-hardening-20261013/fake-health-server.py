# 假健康服务：MODE=first_hang 时第 1 个请求挂 5s（大于测试用的 2s 超时），其余正常；MODE=all_hang 全部挂起
import http.server, json, os, sys, time, threading
mode = os.environ.get('MODE', 'ok'); version = os.environ.get('VER', 'abc')
count = {'n': 0}; lock = threading.Lock()
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        with lock:
            count['n'] += 1; n = count['n']
        if mode == 'all_hang' or (mode == 'first_hang' and n == 1):
            time.sleep(5)
        if self.path.startswith('/api/health'):
            body = json.dumps({'status': 'ok', 'version': version}).encode(); ctype = 'application/json'
        else:
            body = b'<html>ok</html>'; ctype = 'text/html'
        try:
            self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        except BrokenPipeError: pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
