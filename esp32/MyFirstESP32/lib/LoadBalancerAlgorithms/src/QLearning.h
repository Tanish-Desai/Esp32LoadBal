#pragma once
#include "LoadBalancerStrategy.h"

class QLearning : public LoadBalancerStrategy {
private:
    int num_backends;
    int max_states;
    
    // Hyperparameters
    float alpha;   // Learning rate
    float gamma;   // Discount factor
    float epsilon; // Exploration rate (0.0 to 1.0)
    float epsilon_decay; // Rate at which exploration decays
    float min_epsilon;   // Minimum exploration rate

    // The Q-Table: Rows = States (active connections), Cols = Actions (backends)
    // We dynamically allocate this based on config, but it's very small.
    float** q_table;

    float getMaxQ(int state);

public:
    // Pass in the number of backends and the max possible concurrent connections
    QLearning(int backends, int max_concurrent_clients);
    ~QLearning();

    int getNextBackend(int current_state) override;
    void provideFeedback(int backend_idx, int current_state, int next_state, float reward) override;
    void printQTable(); // Useful for debugging via Serial
};