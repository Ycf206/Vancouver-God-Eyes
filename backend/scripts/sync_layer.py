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
    "street_lighting": "update_street_lighting",
    "street_lighting_conduits": "update_street_lighting_conduits",
    "water_distribution_mains": "update_water_distribution_mains",
    "sewer_mains": "update_sewer_mains",
    "traffic_speed_limits": "update_traffic_speed_limits",
    "traffic_crosswalks": "update_traffic_crosswalks",
    "litter_containers": "update_litter_containers",
    "one_way_streets": "update_one_way_streets",
    "snow_removal_routes": "update_snow_removal_routes",
    "contours": "update_contours",
    "ev_charging": "update_ev_charging"
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
    parser = argparse.ArgumentParser(description="Vancouver God's Eye Layer Synchronization Engine")
    parser.add_argument("--layer", type=str, help="指定要同步更新的單一圖層 ID")
    parser.add_argument("--list", action="store_true", help="列出所有可用的 33 個圖層")
    parser.add_argument("--all", action="store_true", help="依序執行所有 33 個圖層同步")

    args = parser.parse_args()

    # Add current dir to sys.path so layers can be imported
    curr_dir = os.path.dirname(os.path.abspath(__file__))
    if curr_dir not in sys.path:
        sys.path.insert(0, curr_dir)

    if args.list:
        print("🗺️ 支援獨立同步的 33 個 Open Data / GIS 圖層清單:")
        for idx, k in enumerate(sorted(LAYERS_MAP.keys()), 1):
            print(f"  {idx:2d}. {k}")
        return

    if args.layer:
        success = run_layer(args.layer)
        sys.exit(0 if success else 1)

    if args.all:
        print("🚀 開始依序更新全部 33 個獨立圖層...")
        for k in sorted(LAYERS_MAP.keys()):
            run_layer(k)
        print("🎉 全部圖層同步執行完畢！")
        return

    parser.print_help()

if __name__ == "__main__":
    main()
