#!/usr/bin/env python3
"""
NPP Monitor - Script de synchronisation officiel avec l'API RTE Développeurs
Récupère la télémesure réelle tranche par tranche (57 réacteurs nucléaires français)
via l'API Actual Generation per Unit de RTE.

Documentation officielle : https://data.rte-france.com
"""

import os
import sys
import json
import base64
import urllib.request
import urllib.error
import datetime
from zoneinfo import ZoneInfo

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')
REACTORS_PATH = os.path.join(BASE_DIR, 'data', 'reactors.json')
OUTPUT_PATH = os.path.join(BASE_DIR, 'data', 'live_units.json')

TOKEN_URL = 'https://digital.iservices.rte-france.com/token/oauth/'
API_ACTUAL_GEN_URL = 'https://digital.iservices.rte-france.com/open_api/actual_generation/v1/actual_generations_per_unit'
API_UNAVAILABILITY_URL = 'https://digital.iservices.rte-france.com/open_api/unavailability_additional_information/v7/generation_unavailabilities'

KNOWN_REASONS = {
    'nogent_1': 'Visite partielle : renouvellement du combustible, maintenance des générateurs de vapeur et modifications de sûreté',
    'paluel_2': 'Visite décennale VD4 (contrôles cuve et enceinte)',
    'cattenom_3': 'Arrêt pour rechargement du combustible et maintenance programmée',
    'dampierre_4': 'Rechargement combustible et contrôle générateurs de vapeur',
    'gravelines_2': 'Visite partielle et renouvellement du combustible',
    'blayais_3': 'Maintenance programmée et rechargement',
    'cruas_1': 'Arrêt pour rechargement du combustible',
    'chinon_b2': 'Visite partielle programmée',
    'bugey_4': 'Arrêt programmé d\'entretien',
    'golfech_1': 'Visite décennale et rechargement',
    'st_laurent_b2': 'Arrêt pour rechargement',
    'tricastin_3': 'Maintenance sur circuit secondaire'
}


def load_config():
    """Charge les identifiants RTE depuis config.json ou l'environnement."""
    # API 1 : Actual Generation
    client_id = os.environ.get('RTE_CLIENT_ID')
    client_secret = os.environ.get('RTE_CLIENT_SECRET')

    # API 2 : Unavailability (Indisponibilités)
    unav_client_id = os.environ.get('RTE_UNAVAILABILITY_CLIENT_ID')
    unav_client_secret = os.environ.get('RTE_UNAVAILABILITY_CLIENT_SECRET')

    if os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                client_id = client_id or cfg.get('rte_client_id')
                client_secret = client_secret or cfg.get('rte_client_secret')
                unav_client_id = unav_client_id or cfg.get('rte_unavailability_client_id')
                unav_client_secret = unav_client_secret or cfg.get('rte_unavailability_client_secret')
        except Exception as e:
            print(f"[!] Erreur de lecture de config.json: {e}")

    return {
        'actual': (client_id, client_secret),
        'unavailability': (unav_client_id, unav_client_secret)
    }


def get_oauth_token(client_id, client_secret, api_name="RTE"):
    """Obtient un jeton porteur OAuth 2.0 auprès de RTE."""
    if not client_id or not client_secret:
        raise ValueError(f"Identifiants manquants pour {api_name}.")

    auth_str = f"{client_id}:{client_secret}"
    b64_auth = base64.b64encode(auth_str.encode('utf-8')).decode('utf-8')

    headers = {
        'Authorization': f'Basic {b64_auth}',
        'Content-Type': 'application/x-www-form-urlencoded'
    }

    req = urllib.request.Request(TOKEN_URL, data=b'', headers=headers, method='POST')

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.load(resp)
            token = data.get('access_token')
            expires_in = data.get('expires_in', 3600)
            print(f"[✓] Jeton OAuth {api_name} obtenu avec succès (valide {expires_in}s).")
            return token
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='ignore')
        raise RuntimeError(f"Erreur d'authentification {api_name} ({e.code}): {err_body}")


def fetch_actual_generation(token):
    """Interroge l'endpoint Actual Generations per Unit pour les 48 dernières heures glissantes jusqu'à aujourd'hui."""
    tz = ZoneInfo("Europe/Paris")
    now = datetime.datetime.now(tz)
    # RTE requiert au moins 2 jours calendaires et un encodage strict des dates
    start_iso = (now - datetime.timedelta(days=2)).strftime('%Y-%m-%dT00:00:00+01:00')
    end_iso = (now + datetime.timedelta(days=1)).strftime('%Y-%m-%dT00:00:00+01:00')

    params = urllib.parse.urlencode({
        'start_date': start_iso,
        'end_date': end_iso
    })
    url = f"{API_ACTUAL_GEN_URL}?{params}"
    print(f"[*] Interrogation de l'API Actual Generation: {url}")

    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/json'
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.load(resp)
            return data
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='ignore')
        raise RuntimeError(f"Erreur API Actual Generation ({e.code}): {err_body}")


def fetch_unavailabilities(token):
    """Interroge l'endpoint Unavailability pour récupérer les arrêts officiellement déclarés."""
    print(f"[*] Interrogation de l'API Unavailability (Indisponibilités)...")
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/json'
    }

    req = urllib.request.Request(API_UNAVAILABILITY_URL, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
            items = data.get('generation_unavailabilities', [])
            nuclear_unavs = {}
            for u in items:
                if u.get('fuel_type') == 'NUCLEAR':
                    eic = u.get('affected_asset_or_unit_eic_code')
                    if eic:
                        nuclear_unavs[eic] = {
                            'name': u.get('affected_asset_or_unit_name'),
                            'type': u.get('unavailability_type'),
                            'status': u.get('event_status'),
                            'startDate': u.get('start_date'),
                            'endDate': u.get('end_date'),
                            'reason': u.get('reason'),
                            'remarks': u.get('remarks')
                        }
            print(f"[✓] {len(nuclear_unavs)} arrêts nucléaires déclarés récupérés depuis RTE Unavailability.")
            return nuclear_unavs
    except Exception as e:
        print(f"[!] Info Unavailability non disponible ou erreur: {e}")
        return {}


def process_and_save_data(rte_data, unavailabilities=None):
    """Croise les télémesures réelles RTE et les indisponibilités officielles avec les 57 réacteurs."""
    if unavailabilities is None:
        unavailabilities = {}

    with open(REACTORS_PATH, 'r', encoding='utf-8') as f:
        reactors = json.load(f)

    eic_map = {r['eicCode']: r for r in reactors if r.get('eicCode')}
    print(f"[*] {len(eic_map)} réacteurs chargés depuis reactors.json.")

    actual_units = rte_data.get('actual_generations_per_unit', [])
    print(f"[*] {len(actual_units)} unités de production reçues depuis RTE.")

    units_result = {}
    total_power = 0
    stopped_count = 0
    running_count = 0
    modulating_count = 0
    commissioning_count = 0

    for item in actual_units:
        unit_info = item.get('unit', {})
        eic = unit_info.get('eic_code')
        if not eic or eic not in eic_map:
            continue

        reactor = eic_map[eic]
        values = item.get('values', [])
        if not values:
            continue

        latest_val = values[-1]
        raw_power = float(latest_val.get('value', 0))
        # Les valeurs négatives indiquent une unité à l'arrêt consommant pour ses auxiliaires
        power_mw = max(0, round(raw_power))
        nominal_mw = reactor.get('netPower_MW', 900)
        load_factor = round((power_mw / nominal_mw) * 100, 1) if nominal_mw > 0 else 0.0

        is_epr = reactor.get('stage') == 'EPR' or reactor['id'] == 'flamanville_3'
        unav = unavailabilities.get(eic)
        outage_end_date = unav.get('endDate') if unav else None

        if is_epr:
            status = 'COMMISSIONING'
            status_label = 'Essais & montée en puissance (EPR)' if power_mw > 0 else 'Palier d\'essais EPR / Arrêt temporaire'
            status_class = 'status-commissioning'
            commissioning_count += 1
            reason = 'Tranche EPR de 3e génération en phase d\'essais réseau et montée en puissance par paliers.'
        elif power_mw <= 0:
            stopped_count += 1
            if unav and unav.get('type') == 'UNPLANNED':
                status = 'UNPLANNED_STOP'
                status_label = 'Arrêt fortuit / imprévu'
                status_class = 'status-unplanned-stop'
            else:
                status = 'PLANNED_STOP'
                status_label = 'À l\'arrêt (0 MW)'
                status_class = 'status-planned-stop'

            if unav and unav.get('remarks') and unav['remarks'].strip() and unav['remarks'] != '-':
                # Nettoyage des retours de ligne pour affichage
                first_remark = unav['remarks'].strip().split('\n')[0]
                reason = first_remark
            else:
                reason = KNOWN_REASONS.get(reactor['id'], 'Arrêt de tranche pour maintenance / rechargement du combustible')
        elif load_factor < 75:
            status = 'MODULATING'
            status_label = 'En modulation (suivi de réseau)'
            status_class = 'status-modulating'
            modulating_count += 1
            if unav and unav.get('remarks') and unav['remarks'].strip() and unav['remarks'] != '-':
                first_remark = unav['remarks'].strip().split('\n')[0]
                reason = f"En modulation / reprise : {first_remark}"
            else:
                reason = 'Puissance modulée à la baisse pour adapter la production aux besoins instantanés du réseau.'
        else:
            status = 'RUNNING'
            status_label = 'En production nominale'
            status_class = 'status-running'
            running_count += 1
            reason = None

        total_power += power_mw

        # Courbe historique des 48 dernières heures glissantes réelles
        history_48h = []
        recent_values = values[-48:] if len(values) >= 48 else values
        for v in recent_values:
            try:
                raw_v = float(v.get('value', 0))
                p = max(0, round(raw_v))
                start_iso = v.get('start_date', '')
                if start_iso:
                    dt = datetime.datetime.fromisoformat(start_iso)
                    label = dt.strftime('%d/%m %Hh')
                else:
                    label = '--'
                history_48h.append({
                    'time': label,
                    'date': start_iso,
                    'power': p
                })
            except Exception:
                continue

        units_result[reactor['id']] = {
            'reactorId': reactor['id'],
            'reactorName': reactor['name'],
            'plantId': reactor['plantId'],
            'stage': reactor.get('stage'),
            'eicCode': eic,
            'currentPower': power_mw,
            'nominalPower': nominal_mw,
            'loadFactor': str(load_factor),
            'status': status,
            'statusLabel': status_label,
            'statusClass': status_class,
            'reason': reason,
            'outageEndDate': outage_end_date,
            'lastUpdated': latest_val.get('start_date'),
            'history': history_48h,
            'history48h': history_48h,
            'history24h': history_48h[-24:]
        }

    output = {
        'source': 'RTE Official API (Actual Generation per Unit)',
        'updatedAt': datetime.datetime.now().isoformat(),
        'unitsCount': len(units_result),
        'totalNuclearMW': total_power,
        'stats': {
            'totalReactors': len(units_result),
            'runningCount': running_count,
            'modulatingCount': modulating_count,
            'stoppedCount': stopped_count,
            'commissioningCount': commissioning_count
        },
        'units': units_result
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    js_output_path = os.path.join(BASE_DIR, 'js', 'live_units.js')
    with open(js_output_path, 'w', encoding='utf-8') as f:
        f.write('// Données officielles RTE en temps réel par tranche (Actual Generation per Unit)\n')
        f.write('const RTE_LIVE_UNITS = ' + json.dumps(output, indent=2, ensure_ascii=False) + ';\n')

    print(f"\n[✓] RÉSULTAT DE LA SYNCHRONISATION RTE :")
    print(f"    - Réacteurs synchronisés : {len(units_result)} / 57")
    print(f"    - Puissance totale mesurée : {total_power:,} MW")
    print(f"    - En production nominale : {running_count}")
    print(f"    - En modulation de charge : {modulating_count}")
    print(f"    - À l'arrêt complet (0 MW) : {stopped_count}")
    print(f"    - EPR en essais : {commissioning_count}")
    print(f"    - Données JSON : {OUTPUT_PATH}")
    print(f"    - Données JS standalone : {js_output_path}")
    return output


def run_sync():
    """Exécute une passe complète de synchronisation avec les APIs RTE (Actual Gen + Unavailability)."""
    cfg = load_config()
    actual_id, actual_secret = cfg['actual']
    unav_id, unav_secret = cfg['unavailability']

    try:
        # 1. Récupération des puissances réelles instantanées
        actual_token = get_oauth_token(actual_id, actual_secret, api_name="Actual Generation")
        rte_actual_data = fetch_actual_generation(actual_token)

        # 2. Récupération des indisponibilités officielles déclarées (si identifiants configurés)
        unavailabilities = {}
        if unav_id and unav_secret:
            try:
                unav_token = get_oauth_token(unav_id, unav_secret, api_name="Unavailability")
                unavailabilities = fetch_unavailabilities(unav_token)
            except Exception as e:
                print(f"[!] Avertissement Unavailability: {e}")

        # 3. Traitement et fusion des données
        output = process_and_save_data(rte_actual_data, unavailabilities=unavailabilities)
        return True, output
    except Exception as e:
        print(f"\n[✗] Échec de la synchronisation : {e}")
        return False, str(e)


def main():
    print("=" * 65)
    print(" ⚛️  NPP MONITOR - SYNCHRONISATION OFFICIELLE RTE API")
    print("=" * 65)

    success, res = run_sync()
    if success:
        print("\n[✓] Synchronisation réussie avec les données réelles de RTE !")
    else:
        sys.exit(2)


if __name__ == '__main__':
    main()
