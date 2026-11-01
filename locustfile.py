"""
Comprehensive Locust Load Testing Script for Vancouver God's Eye (https://vangodseye.fyi)
Simulates concurrent user navigation, layer data fetching, and real-time transit/weather polling.
"""

from locust import HttpUser, task, between, tag
import random

class GodsEyeUser(HttpUser):
    # Simulate user think time between 1 and 2 seconds
    wait_time = between(1.0, 2.0)

    @tag('homepage')
    @task(6)
    def load_homepage(self):
        """Simulate user opening the main application page."""
        with self.client.get("/", catch_response=True) as resp:
            if resp.status_code == 200:
                resp.success()
            else:
                resp.failure(f"Homepage load failed with status {resp.status_code}")

    @tag('geojson_layers')
    @task(8)
    def load_cached_layers(self):
        """Simulate loading static GeoJSON layers that users toggle on the map."""
        layers = [
            "/vancouver_drinking_fountains.geojson",
            "/vancouver_public_washrooms.geojson",
            "/vancouver_food_banks.geojson",
            "/vancouver_community_centres.geojson",
            "/vancouver_parks.geojson",
            "/vancouver_canada_post.geojson"
        ]
        layer = random.choice(layers)
        with self.client.get(layer, name="[GeoJSON] Static Map Layer", catch_response=True) as resp:
            if resp.status_code == 200:
                resp.success()
            else:
                resp.failure(f"Layer {layer} returned {resp.status_code}")

    @tag('skytrain')
    @task(10)
    def get_skytrain_trains(self):
        """Simulate frequent real-time SkyTrain live feed requests."""
        with self.client.get("/api/skytrain/trains", name="[API] /api/skytrain/trains", catch_response=True) as resp:
            if resp.status_code in [200, 304]:
                resp.success()
            else:
                resp.failure(f"SkyTrain trains failed: {resp.status_code}")

    @tag('maritime_and_ferries')
    @task(8)
    def get_maritime_and_ferries(self):
        """Simulate maritime shipping and BC Ferries live tracking."""
        endpoint = random.choice(["/api/shipping/vessels", "/api/ferries/active"])
        with self.client.get(endpoint, name=f"[API] {endpoint}", catch_response=True) as resp:
            if resp.status_code in [200, 304]:
                resp.success()
            else:
                resp.failure(f"{endpoint} failed: {resp.status_code}")

    @tag('weather_aurora')
    @task(8)
    def get_weather_and_aurora(self):
        """Simulate Weather and Aurora explore tab requests."""
        endpoint = random.choice(["/api/weather/current", "/api/aurora/live"])
        with self.client.get(endpoint, name=f"[API] {endpoint}", catch_response=True) as resp:
            if resp.status_code in [200, 304]:
                resp.success()
            else:
                resp.failure(f"{endpoint} failed: {resp.status_code}")

    @tag('traffic_transit')
    @task(6)
    def get_traffic_and_transit(self):
        """Simulate traffic summary and transit alerts."""
        endpoint = random.choice(["/api/traffic/summary", "/api/translink/alerts"])
        with self.client.get(endpoint, name=f"[API] {endpoint}", catch_response=True) as resp:
            if resp.status_code in [200, 304]:
                resp.success()
            else:
                resp.failure(f"{endpoint} failed: {resp.status_code}")

    @tag('border_flights')
    @task(6)
    def get_border_and_flights(self):
        """Simulate border wait times and flight arrivals/departures."""
        endpoint = random.choice(["/api/border/wait-times", "/api/flights/live"])
        with self.client.get(endpoint, name=f"[API] {endpoint}", catch_response=True) as resp:
            if resp.status_code in [200, 304]:
                resp.success()
            else:
                resp.failure(f"{endpoint} failed: {resp.status_code}")

    @tag('health')
    @task(4)
    def check_health(self):
        """Simulate healthcheck."""
        with self.client.get("/health", name="[API] /health", catch_response=True) as resp:
            if resp.status_code in [200, 304]:
                resp.success()
            else:
                resp.failure(f"Healthcheck failed: {resp.status_code}")


class HeavyBurstUser(HttpUser):
    """
    Simulates aggressive or automated burst traffic (e.g. rapid polling or flash crowd).
    """
    wait_time = between(0.1, 0.4)

    @tag('burst')
    @task(1)
    def burst_poll(self):
        endpoints = [
            "/api/skytrain/trains",
            "/api/weather/current",
            "/api/shipping/vessels",
            "/api/flights/live",
            "/vancouver_drinking_fountains.geojson"
        ]
        ep = random.choice(endpoints)
        with self.client.get(ep, name="[Burst] Rapid Polling", catch_response=True) as resp:
            if resp.status_code in [200, 304]:
                resp.success()
            elif resp.status_code == 429:
                resp.success()
            else:
                resp.failure(f"Burst request to {ep} failed: {resp.status_code}")
