from PIL import Image

img = Image.open(r"D:\your-game\public\button-bg.png").convert("RGBA")
datas = img.getdata()

newData = []
for item in datas:
    # If pixel is close to white, make it transparent
    if item[0] > 240 and item[1] > 240 and item[2] > 240:
        newData.append((255, 255, 255, 0))
    else:
        newData.append(item)

img.putdata(newData)
img.save(r"D:\your-game\public\button-bg.png", "PNG")
print("Done")
