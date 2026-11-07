#!/usr/bin/env python3
"""
NPP Monitor - Serveur Local
Permet de lancer le site localement en une seule commande : python3 server.py
"""

import http.server
import socketserver
import os
import sys
import webbrowser

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Activation des en-têtes CORS pour les requêtes locales
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def guess_type(self, path):
        # Types MIME corrects
        if path.endswith('.js'):
            return 'application/javascript; charset=utf-8'
        elif path.endswith('.json'):
            return 'application/json; charset=utf-8'
        elif path.endswith('.css'):
            return 'text/css; charset=utf-8'
        elif path.endswith('.html'):
            return 'text/html; charset=utf-8'
        return super().guess_type(path)

def find_available_port(start_port=8080):
    import socket
    port = start_port
    while port < start_port + 50:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', port)) != 0:
                return port
        port += 1
    return start_port

def run():
    port = find_available_port(PORT)
    url = f"http://localhost:{port}"

    print("=" * 60)
    print(" ⚛️  NPP MONITOR - SERVEUR LOCAL")
    print("=" * 60)
    print(f" ▶ Serveur démarré avec succès !")
    print(f" ▶ URL locale : {url}")
    print(f" ▶ Dossier    : {DIRECTORY}")
    print("=" * 60)
    print(" Appuyez sur Ctrl+C pour arrêter le serveur.\n")

    # Ouvrir automatiquement le navigateur si lancé directement
    if len(sys.argv) > 1 and sys.argv[1] == '--open':
        webbrowser.open(url)

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nArrêt du serveur NPP Monitor...")
            httpd.server_close()

if __name__ == '__main__':
    run()
