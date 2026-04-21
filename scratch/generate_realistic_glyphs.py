import json
import math
import os

def distance(x1, y1, x2, y2):
    return math.sqrt((x2-x1)**2 + (y2-y1)**2)

def get_closest_point(glon, glat, path_coords):
    min_dist = float('inf')
    closest_pt = None
    for (px, py) in path_coords:
        d = distance(glon, glat, px, py)
        if d < min_dist:
            min_dist = d
            closest_pt = (px, py)
    return closest_pt

def calculate_category(wind_speed):
    if wind_speed >= 157: return 5
    if wind_speed >= 130: return 4
    if wind_speed >= 111: return 3
    if wind_speed >= 96: return 2
    if wind_speed >= 74: return 1
    return 0 # Tropical Storm / Depression

def process_data():
    input_path = '/Users/oliviahu/Desktop/school/26 SPRING/CS7450/cs7450/Hurricane_Uncertainty_Vis/src/cone_data.json'
    output_path = '/Users/oliviahu/Desktop/school/26 SPRING/CS7450/cs7450/Hurricane_Uncertainty_Vis/src/realistic_hurricane_glyphs.json'

    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found.")
        return

    with open(input_path, 'r') as f:
        data = json.load(f)

    RMW = 0.36 # degrees (~40km)
    VMAX = 115.0 # mph (Category 3)
    
    new_lines = []
    
    for line in data['lines']:
        # Parse path coords
        path_str = line['path']
        path_coords = []
        for pt in path_str.split(' '):
            try:
                # Remove M or L prefix
                coord_str = pt[1:]
                lon, lat = map(float, coord_str.split(','))
                path_coords.append((lon, lat))
            except:
                continue

        new_glyphs = []
        for glyph in line['glyphs']:
            glon = glyph['longitude']
            glat = glyph['latitude']
            dist = glyph['proximity_to_eye']
            
            # 1. Wind Speed (Modified Rankine Vortex)
            if dist <= 0:
                wind_speed = 0
            elif dist < RMW:
                # Linear increase inside the eyewall
                wind_speed = VMAX * (dist / RMW)
            else:
                # Decay outside the eyewall (r^-0.5)
                wind_speed = VMAX * math.pow(RMW / dist, 0.5)
            
            # Add some slight ambient wind variation
            wind_speed += 5.0
            
            # 2. Wind Flow Angle
            closest_eye = get_closest_point(glon, glat, path_coords)
            if closest_eye:
                dx = glon - closest_eye[0]
                dy = glat - closest_eye[1]
                
                if dx == 0 and dy == 0:
                    flow_angle = 0
                else:
                    # Radial angle
                    alpha = math.atan2(dy, dx)
                    # Tangential + 20 deg inflow
                    # 90 deg CCW is tangential, + 20 deg inwards
                    # Total is alpha + 110 degrees
                    phi = alpha + math.radians(110)
                    
                    flow_angle = math.degrees(phi)
                    if flow_angle < 0:
                        flow_angle += 360
                    elif flow_angle >= 360:
                        flow_angle -= 360
            else:
                flow_angle = glyph['wind_flow_angle']

            # 3. Precipitation
            # Scale 0.0 to 4.0 based on proximity to eyewall
            # Max at RMW, decays quickly outside and inside
            precip = 4.0 * math.exp(-abs(dist - RMW) / 0.8)
            
            # 4. Update glyph
            new_glyph = glyph.copy()
            new_glyph['wind_speed'] = round(wind_speed)
            new_glyph['wind_flow_angle'] = round(flow_angle, 1)
            new_glyph['precipitation'] = round(precip, 2)
            new_glyph['category'] = calculate_category(wind_speed)
            new_glyph['wind_gust'] = round(wind_speed * 1.25)
            new_glyph['temperature'] = round(28.0 - (wind_speed / 25.0), 1)
            
            new_glyphs.append(new_glyph)
        
        new_line = line.copy()
        new_line['glyphs'] = new_glyphs
        new_lines.append(new_line)

    new_data = {"lines": new_lines}
    
    with open(output_path, 'w') as f:
        json.dump(new_data, f, indent=4)
    
    print(f"Successfully generated {output_path}")

if __name__ == "__main__":
    process_data()
