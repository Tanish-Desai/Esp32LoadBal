#pragma once
#include "LoadBalancerStrategy.h"

class EmaResponseTime : public LoadBalancerStrategy {
private:
    int num_backends;
    float alpha;         // Smoothing factor (0.0 to 1.0)
    float* ema_rewards;  // Array holding the current EMA for each server

public:
    // alpha = 0.3 is a good default. It reacts reasonably fast to changes.
    EmaResponseTime(int backends, float learning_rate = 0.3f);
    ~EmaResponseTime();

    int getNextBackend(int current_state = 0) override;
    void provideFeedback(int backend_idx, int current_state, int next_state, float reward) override;
};