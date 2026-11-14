import os
import sys
import argparse
import importlib

# Ensure stdout handles UTF-8 on Windows
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

LAYERS_MAP = {
    "beach_water": "update_beach_water",
    "impark_parking": "update_impark_parking",
    "schools": "update_schools",
    "libraries": "update_libraries",
    "parks": "update_parks",
    "community_centres": "update_community_centres",
    "public_art": "update_public_art",
    "museums": "update_museums",
    "garbage_collection": "update_garbage_collection",
    "recycling": "update_recycling",
    "homeless_shelters": "update_homeless_shelters",
    "food_banks": "update_food_banks",
    "food_vendors": "update_food_vendors",
    "aed": "update_aed",
    "zoning_districts": "update_zoning_districts",
    "parking_meters": "update_parking_meters",
    "motorcycle_parking": "update_motorcycle_parking",
    "bikeways": "update_bikeways",
    "public_trees": "update_public_trees",
    "fire_hydrants": "update_fire_hydrants",
    "drinking_fountains": "update_drinking_fountains",
    "public_washrooms": "update_public_washrooms",
    "traffic_speed_limits": "update_traffic_speed_limits",
    "traffic_crosswalks": "update_traffic_crosswalks",
    "litter_containers": "update_litter_containers",
    "one_way_streets": "update_one_way_streets",
    "snow_removal_routes": "update_snow_removal_routes",
    "contours": "update_contours",
    "ev_charging": "update_ev_charging",
    "canada_post": "update_canada_post",
    "property_addresses": "update_property_addresses",
    "banks": "update_banks",
    "shared_bikes": "update_shared_bikes",
    "escooter": "update_escooter",
    "truck_routes": "update_truck_routes",
    "traffic_signals": "update_traffic_signals",
    "turn_restrictions": "update_traffic_turn_restrictions",
    "service_requests_311": "update_311",
    "vancouver_311": "update_311",
    "consulates": "update_consulates",
    "vancouver_railways": "update_railways",
    "fedex": "update_fedex",
    "purolator": "update_purolator",
    "vancouver_crashes": "update_crashes",
    "yvr_indoor": "update_yvr_indoor",
    "yvr_flights": "update_yvr_flights",
    "bchydro_outages": "update_bchydro_outages",
}

def run_layer(layer_id):
    if layer_id not in LAYERS_MAP:
        print(f"❌ 未知圖層: {layer_id}")
        print(f"可用圖層: {', '.join(sorted(LAYERS_MAP.keys()))}")
        return False

    module_name = LAYERS_MAP[layer_id]
    try:
        mod = importlib.import_module(f"layers.{module_name}")
        fn = getattr(mod, module_name, None)
        if callable(fn):
            fn()
            return True
        else:
            print(f"❌ 模組 {module_name} 找不到同名執行函數")
            return False
    except Exception as e:
        print(f"❌ 執行圖層 [{layer_id}] 發生例外錯誤: {e}")
        return False

def main():
    total_layers = len(LAYERS_MAP)
    parser = argparse.ArgumentParser(description="Vancouver God's Eye Layer Synchronization Engine")
    parser.add_argument("--layer", type=str, help="指定要同步更新的單一圖層 ID")
    parser.add_argument("--list", action="store_true", help=f"列出所有可用的 {total_layers} 個圖層")
    parser.add_argument("--all", action="store_true", help=f"依序執行所有 {total_layers} 個圖層同步")

    args = parser.parse_args()

    # Add current dir to sys.path so layers can be imported
    curr_dir = os.path.dirname(os.path.abspath(__file__))
    if curr_dir not in sys.path:
        sys.path.insert(0, curr_dir)

    if args.list:
        print(f"🗺️ 支援獨立同步的 {total_layers} 個 Open Data / GIS 圖層清單:")
        for idx, k in enumerate(sorted(LAYERS_MAP.keys()), 1):
            print(f"  {idx:2d}. {k}")
        return

    if args.layer:
        success = run_layer(args.layer)
        sys.exit(0 if success else 1)

    if args.all:
        print(f"🚀 開始依序更新全部 {total_layers} 個獨立圖層...")
        for k in sorted(LAYERS_MAP.keys()):
            run_layer(k)
        print("🎉 全部圖層同步執行完畢！")
        return

    parser.print_help()

if __name__ == "__main__":
    main()
