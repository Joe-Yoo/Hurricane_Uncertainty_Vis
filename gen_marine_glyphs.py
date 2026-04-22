import json
import random
import math

lines = []

def distance(x1, y1, x2, y2):
    return math.sqrt((x2-x1)**2 + (y2-y1)**2)

def generate_hurricane_grid(path_coords, v_max):
    glyphs = []
    # Grid limits [-105, -60], [15, 45] with 3.0 degree spacing for Marine grid density
    lon_start, lon_end, lon_step = -105.0, -60.0, 3.0
    lat_start, lat_end, lat_step = 15.0, 45.0, 3.0
    
    rmax = 0.8 # approx radius of max winds
    
    lat = lat_start
    while lat <= lat_end:
        lon = lon_start
        while lon <= lon_end:
            # find closest point on path (approximating closest pass)
            min_dist = float('inf')
            closest_pt = None
            
            for (px, py) in path_coords:
                d = distance(lon, lat, px, py)
                if d < min_dist:
                    min_dist = d
                    closest_pt = (px, py)
            
            # W = W_max * exp(-dist / R)
            ambient = random.uniform(5, 15)
            wind_speed = ambient + v_max * math.exp(-min_dist / (1.5 * rmax))
            
            # Cyclonic direction: Counter-clockwise flow in NH
            dx = lon - closest_pt[0]
            dy = lat - closest_pt[1]
            
            if dx == 0 and dy == 0:
                flow_angle = 0
            else:
                flow_dx, flow_dy = -dy, dx # 90 deg CCW
                # Add frictional inward convergence pull towards the eye
                flow_dx -= dx * 0.3
                flow_dy -= dy * 0.3
                flow_angle = math.degrees(math.atan2(flow_dy, flow_dx))
                if flow_angle < 0:
                    flow_angle += 360

            category = 1
            if wind_speed > 130: category = 4
            elif wind_speed > 111: category = 3
            elif wind_speed > 96: category = 2

            temperature = 30.0 - (wind_speed / 20.0) + random.uniform(-1, 1)

            glyph = {
                "longitude": round(lon, 2),
                "latitude": round(lat, 2),
                "category": category,
                "proximity_to_eye": round(min_dist, 2),
                "wind_speed": round(wind_speed), 
                "wind_flow_angle": round(flow_angle, 1),
                "wind_gust": round(wind_speed * 1.3),
                "precipitation": round(random.uniform(0, 0.5) + (8.0 * math.exp(-min_dist / rmax)), 2),
                "precipitation_type": "RAIN",
                "temperature": round(temperature, 1),
                "event_code": "WARNING" if wind_speed > 60 else ("ADVISORY" if wind_speed > 30 else "NONE")
            }
            glyphs.append(glyph)
            lon += lon_step
        lat += lat_step
    return glyphs

for i in range(1, 52):
    path_parts = []
    path_coords = []
    num_steps = 40
    
    lon = -86.0 + random.gauss(0, 0.4) 
    lat = 18.0 + random.gauss(0, 0.4)
    v_lon = -0.4 + random.gauss(0, 0.1) 
    v_lat = 0.35 + random.gauss(0, 0.05)
    
    # Random realistic max sustained wind
    storm_v_max = random.uniform(80, 160)

    for step in range(num_steps):
        if step == 0:
            path_parts.append(f"M{lon:.2f},{lat:.2f}")
        else:
            path_parts.append(f"L{lon:.2f},{lat:.2f}")
        path_coords.append((lon, lat))
            
        v_lon += random.gauss(0, 0.04)
        v_lat += random.gauss(0, 0.035)
        
        if lat > 24.0:
            v_lon += random.uniform(0.02, 0.08) * (lat - 24.0)
            
        lon += v_lon
        lat += v_lat
        
    line = {
        "id": i,
        "path": " ".join(path_parts),
        "glyphs": generate_hurricane_grid(path_coords, storm_v_max)
    }
    lines.append(line)

data = {"lines": lines}

with open('/Users/oliviahu/Desktop/school/26 SPRING/CS7450/cs7450/Hurricane_Uncertainty_Vis/src/cone_data.json', 'w') as f:
    json.dump(data, f, indent=4)
print("done")
