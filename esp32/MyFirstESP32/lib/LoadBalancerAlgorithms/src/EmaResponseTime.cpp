#include "EmaResponseTime.h"

EmaResponseTime::EmaResponseTime(int backends, float learning_rate) {
    num_backends = backends;
    alpha = learning_rate;
    ema_rewards = new float[num_backends];
    
    // Initialize with a high default reward (Optimistic Initialization).
    // This forces the load balancer to try EVERY server at least once 
    // before settling on the fastest one.
    for (int i = 0; i < num_backends; i++) {
        ema_rewards[i] = 1000.0f; 
    }
}

EmaResponseTime::~EmaResponseTime() {
    delete[] ema_rewards;
}

int EmaResponseTime::getNextBackend(int current_state) {
    // Find the server with the highest EMA Reward (meaning lowest latency)
    int best_backend = 0;
    float highest_reward = ema_rewards[0];

    for (int i = 1; i < num_backends; i++) {
        if (ema_rewards[i] > highest_reward) {
            highest_reward = ema_rewards[i];
            best_backend = i;
        }
    }
    return best_backend;
}

void EmaResponseTime::provideFeedback(int backend_idx, int current_state, int next_state, float reward) {
    // The EMA Formula
    // We update the specific backend's score using the newly calculated reward
    ema_rewards[backend_idx] = (reward * alpha) + (ema_rewards[backend_idx] * (1.0f - alpha));
}