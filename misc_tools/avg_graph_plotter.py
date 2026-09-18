import pandas as pd
import matplotlib.pyplot as plt

# Read your generated CSV
df = pd.read_csv('results_log.csv', names=['Algorithm', 'Time', 'ResponseTime'])

# Plotting logic
plt.figure(figsize=(10, 6))
for algo in ['Round-Robin', 'Q-Learning', 'EMA']:
    subset = df[df['Algorithm'] == algo]
    # Use a rolling average to make the lines smooth, just like your dashboard!
    plt.plot(subset['Time'], subset['ResponseTime'].rolling(window=5).mean(), label=algo)

plt.title('Algorithm Response Time Under Dynamic Load')
plt.xlabel('Time (s)')
plt.ylabel('Average Response Time (ms)')
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show() # Save this image for your PPT!