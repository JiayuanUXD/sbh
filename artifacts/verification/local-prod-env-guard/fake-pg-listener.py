"""假 PG 监听器：只记录有没有进程来连，不说 PG 协议。连上即记一行并关闭。"""
import socket, sys, datetime
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((host, port)); s.listen(16)
print(f"{datetime.datetime.now().isoformat()} LISTEN {host}:{port}", flush=True)
while True:
    c, addr = s.accept()
    print(f"{datetime.datetime.now().isoformat()} CONNECT from {addr[0]}:{addr[1]}", flush=True)
    c.close()
