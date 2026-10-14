from PIL import Image

img = Image.open(r"D:\your-game\public\button-bg.png").convert("RGBA")
pixels = img.load()
width, height = img.size

# Flood fill from corners to safely remove the background without touching the white text
stack = [(0, 0), (width-1, 0), (0, height-1), (width-1, height-1)]
visited = set(stack)

while stack:
    x, y = stack.pop()
    r, g, b, a = pixels[x, y]
    # Check if pixel is close to white
    if r > 220 and g > 220 and b > 220 and a > 0:
        pixels[x, y] = (255, 255, 255, 0) # Make transparent
        # add neighbors
        for dx, dy in [(-1,0), (1,0), (0,-1), (0,1)]:
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height:
                if (nx, ny) not in visited:
                    visited.add((nx, ny))
                    stack.append((nx, ny))

img.save(r"D:\your-game\public\button-bg.png", "PNG")
print("Done")
