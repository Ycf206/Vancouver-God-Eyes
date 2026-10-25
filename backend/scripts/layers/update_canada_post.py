import os
import sys
import json
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, sync_facility_to_db

CANADA_POST_QUERY_URL = "https://pub.geo.canadapost-postescanada.ca/server/rest/services/Hosted/FPO_FLEX_FACILITY_RETAIL_POINT/FeatureServer/0/query"

def title_case(text: str) -> str:
    if not text:
        return ""
    words = text.strip().split()
    return " ".join(w.capitalize() if not w.startswith("#") else w for w in words)

def update_canada_post():
    print("⚡ 正在更新 Canada Post 郵政據點...")

    # 4.2 Geometry rings & Vancouver mailingplace filter
    geometry = {
        "rings": [[
            [-13690389.563014038, 6313884.080275681], [-13690443.089933073, 6312249.002044927],
            [-13690603.441479692, 6310620.92547018], [-13690869.931003958, 6309006.822225277],
            [-13691241.417356811, 6307413.604148118], [-13691716.30977666, 6305848.093643102],
            [-13692292.574701255, 6304316.994466553], [-13692967.74447572, 6302826.863020206],
            [-13693738.927919427, 6301384.080275681], [-13694602.822706474, 6299994.824450191],
            [-13695555.729506757, 6298665.044550463], [-13696593.567827063, 6297400.434898179],
            [-13697711.893484375, 6296206.4107460175], [-13698905.917636536, 6295088.085088707],
            [-13700170.52728882, 6294050.2467684], [-13701500.307188548, 6293097.339968117],
            [-13702889.563014038, 6292233.44518107], [-13704332.345758563, 6291462.261737363],
            [-13705822.477204911, 6290787.091962899], [-13707353.576381458, 6290210.827038303],
            [-13708919.086886475, 6289735.934618454], [-13710512.304963635, 6289364.4482656],
            [-13712126.408208536, 6289097.958741335], [-13713754.484783284, 6288937.607194716],
            [-13715389.563014038, 6288884.080275681], [-13717024.641244791, 6288937.607194716],
            [-13718652.71781954, 6289097.958741335], [-13720266.82106444, 6289364.4482656],
            [-13721860.039141601, 6289735.934618454], [-13723425.549646618, 6290210.827038303],
            [-13724956.648823164, 6290787.091962899], [-13726446.780269513, 6291462.261737363],
            [-13727889.563014038, 6292233.44518107], [-13729278.818839528, 6293097.339968117],
            [-13730608.598739255, 6294050.2467684], [-13731873.20839154, 6295088.085088707],
            [-13733067.232543701, 6296206.4107460175], [-13734185.558201013, 6297400.434898179],
            [-13735223.396521319, 6298665.044550463], [-13736176.303321602, 6299994.824450191],
            [-13737040.198108649, 6301384.080275681], [-13737811.381552355, 6302826.863020206],
            [-13738486.55132682, 6304316.994466553], [-13739062.816251416, 6305848.093643102],
            [-13739537.708671264, 6307413.604148118], [-13739909.195024118, 6309006.822225277],
            [-13740175.684548384, 6310620.92547018], [-13740336.036095003, 6312249.002044927],
            [-13740389.563014038, 6313884.080275681], [-13740336.036095003, 6315519.158506434],
            [-13740175.684548384, 6317147.235081182], [-13739909.195024118, 6318761.338326084],
            [-13739537.708671264, 6320354.556403244], [-13739062.816251416, 6321920.06690826],
            [-13738486.55132682, 6323451.166084808], [-13737811.381552355, 6324941.297531156],
            [-13737040.198108649, 6326384.080275681], [-13736176.303321602, 6327773.336101171],
            [-13735223.396521319, 6329103.116000899], [-13734185.558201013, 6330367.725653183],
            [-13733067.232543701, 6331561.749805344], [-13731873.20839154, 6332680.075462655],
            [-13730608.598739255, 6333717.913782962], [-13729278.818839528, 6334670.820583245],
            [-13727889.563014038, 6335534.715370292], [-13726446.780269513, 6336305.898813998],
            [-13724956.648823164, 6336981.068588463], [-13723425.549646618, 6337557.333513059],
            [-13721860.039141601, 6338032.225932907], [-13720266.82106444, 6338403.712285762],
            [-13718652.71781954, 6338670.201810027], [-13717024.641244791, 6338830.553356646],
            [-13715389.563014038, 6338884.080275681], [-13713754.484783284, 6338830.553356646],
            [-13712126.408208536, 6338670.201810027], [-13710512.304963635, 6338403.712285762],
            [-13708919.086886475, 6338032.225932907], [-13707353.576381458, 6337557.333513059],
            [-13705822.477204911, 6336981.068588463], [-13704332.345758563, 6336305.898813998],
            [-13702889.563014038, 6335534.715370292], [-13701500.307188548, 6334670.820583245],
            [-13700170.52728882, 6333717.913782962], [-13698905.917636536, 6332680.075462655],
            [-13697711.893484375, 6331561.749805344], [-13696593.567827063, 6330367.725653183],
            [-13695555.729506757, 6329103.116000899], [-13694602.822706474, 6327773.336101171],
            [-13693738.927919427, 6326384.080275681], [-13692967.74447572, 6324941.297531156],
            [-13692292.574701255, 6323451.166084808], [-13691716.30977666, 6321920.06690826],
            [-13691241.417356811, 6320354.556403244], [-13690869.931003958, 6318761.338326084],
            [-13690603.441479692, 6317147.235081182], [-13690443.089933073, 6315519.158506434],
            [-13690389.563014038, 6313884.080275681]
        ]]
    }

    payload = {
        "f": "json",
        "geometry": json.dumps(geometry),
        "geometryType": "esriGeometryPolygon",
        "spatialRel": "esriSpatialRelIntersects",
        "inSR": "3857",
        "outFields": "*",
        "outSR": "4326",
        "where": "UPPER(mailingplace) = 'VANCOUVER'",
        "returnGeometry": "true"
    }

    features = []

    try:
        resp = requests.post(CANADA_POST_QUERY_URL, data=payload, timeout=25)
        resp.raise_for_status()
        data = resp.json()
        raw_features = data.get("features", [])
        print(f"ℹ️ Canada Post API 回傳 {len(raw_features)} 處分店資料。")

        for f in raw_features:
            attrs = f.get("attributes", {})
            geom = f.get("geometry", {})
            lon = geom.get("x")
            lat = geom.get("y")

            if lon is None or lat is None:
                continue

            obj_id = attrs.get("objectid") or attrs.get("site") or attrs.get("sourceid")
            site_business = attrs.get("sitebusinessname") or attrs.get("label") or "Canada Post"
            postal_address = attrs.get("postaladdress") or attrs.get("structureaddress") or ""
            facility_type_en = attrs.get("facilitytypeen") or attrs.get("officetypeen") or "Retail Postal Outlet"
            opening_date = attrs.get("openingdate")

            # 營業時間擷取
            schedule = {
                "mon": f"{attrs.get('openmonam') or attrs.get('openmonpm') or ''} - {attrs.get('closemonpm') or attrs.get('closemonam') or ''}".strip(" -"),
                "tue": f"{attrs.get('opentueam') or attrs.get('opentuepm') or ''} - {attrs.get('closetuepm') or attrs.get('closetueam') or ''}".strip(" -"),
                "wed": f"{attrs.get('openwedam') or attrs.get('openwedpm') or ''} - {attrs.get('closewedpm') or attrs.get('closewedam') or ''}".strip(" -"),
                "thu": f"{attrs.get('openthuam') or attrs.get('openthupm') or ''} - {attrs.get('closethupm') or attrs.get('closethuam') or ''}".strip(" -"),
                "fri": f"{attrs.get('openfriam') or attrs.get('openfripm') or ''} - {attrs.get('closefripm') or attrs.get('closefriam') or ''}".strip(" -"),
                "sat": f"{attrs.get('opensatam') or attrs.get('opensatpm') or ''} - {attrs.get('closesatpm') or attrs.get('closesatam') or ''}".strip(" -"),
                "sun": f"{attrs.get('opensunam') or attrs.get('opensunpm') or ''} - {attrs.get('closesunpm') or attrs.get('closesunam') or ''}".strip(" -")
            }

            feat = {
                "type": "Feature",
                "id": f"cp_{obj_id}",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(float(lon), 6), round(float(lat), 6)]
                },
                "properties": {
                    "id": f"cp_{obj_id}",
                    "object_id": obj_id,
                    "facility_type": "canada_post",
                    "name": title_case(site_business),
                    "sitebusinessname": site_business,
                    "postaladdress": postal_address,
                    "address": title_case(postal_address),
                    "local_area": attrs.get("mailingplace") or "Vancouver",
                    "facilitytypeen": facility_type_en,
                    "openingdate": opening_date,
                    "schedule": schedule,
                    "opensunam": attrs.get("opensunam"),
                    "opensunpm": attrs.get("opensunpm"),
                    "closesunam": attrs.get("closesunam"),
                    "closesunpm": attrs.get("closesunpm"),
                    "postalcode": attrs.get("postalcode") or attrs.get("flexpostalcode") or "",
                    "source": "Canada Post Retail Points API"
                }
            }
            features.append(feat)

    except Exception as e:
        print(f"⚠️ Canada Post API 查詢失敗: {e}")

    # 若抓取失敗則使用現有快取
    if not features:
        existing = load_existing_geojson("vancouver_canada_post.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_canada_post.geojson", features)
        sync_facility_to_db("canada_post", features)
        print(f"✅ Canada Post 郵政據點更新完成，共 {len(features)} 處分店。")

    return features

if __name__ == "__main__":
    update_canada_post()
