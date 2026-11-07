#!/usr/bin/env python3
"""
NPP Monitor - Serveur Local
Permet de lancer le site localement en une seule commande : python3 server.py
"""

import http.server
import socketserver
import os
import sys
import json
import threading
import time
import webbrowser

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Import du module de synchronisation RTE
try:
    sys.path.insert(0, os.path.join(DIRECTORY, 'scripts'))
    import fetch_rte_units
except ImportError:
    fetch_rte_units = None

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        # Point d'accès pour déclencher un rafraîchissement RTE immédiat
        if self.path == '/api/refresh-rte':
            if fetch_rte_units:
                success, data = fetch_rte_units.run_sync()
                self.send_response(200 if success else 500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                response = {
                    'success': success,
                    'timestamp': time.time(),
                    'message': 'Synchronisation RTE terminée avec succès' if success else str(data)
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                return
            else:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'{"success": false, "message": "Module fetch_rte_units indisponible"}')
                return

        return super().do_GET()

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

def start_background_rte_syncer(interval_minutes=15):
    """Boucle d'arrière-plan pour rafraîchir automatiquement l'API RTE toutes les 15 minutes."""
    if not fetch_rte_units:
        return

    def sync_loop():
        time.sleep(3) # Petite attente au démarrage
        while True:
            try:
                print("\n[🔄 Background Sync] Rafraîchissement automatique de la télémesure RTE...")
                fetch_rte_units.run_sync()
            except Exception as e:
                print(f"[!] Erreur de synchronisation en tâche de fond: {e}")
            time.sleep(interval_minutes * 60)

    t = threading.Thread(target=sync_loop, daemon=True)
    t.start()

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
    print(" ⚛️  NPP MONITOR - SERVEUR LOCAL & API SYNC")
    print("=" * 60)
    print(f" ▶ Serveur web démarré avec succès !")
    print(f" ▶ URL locale     : {url}")
    print(f" ▶ Dossier        : {DIRECTORY}")
    print(f" ▶ Synchro RTE    : Active toutes les 15 minutes en tâche de fond")
    print("=" * 60)
    print(" Appuyez sur Ctrl+C pour arrêter le serveur.\n")

    # Démarrage de la boucle de synchronisation temps réel avec RTE
    start_background_rte_syncer(interval_minutes=15)

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
