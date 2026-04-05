#include "QLearning.h"
#include <Arduino.h>
#include <cstdlib>

QLearning::QLearning(int backends, int max_concurrent_clients) {
    num_backends = backends;
    max_states = max_concurrent_clients + 1; // +1 to include '0' connections state
    
    alpha = 0.1f;    // Learn gradually
    gamma = 0.5f;    // Moderate focus on future states
    epsilon = 0.2f;  // Explore random servers 20% of the time

    // Initialize Q-Table with 0.0
    q_table = new float*[max_states];
    for (int i = 0; i < max_states; i++) {
        q_table[i] = new float[num_backends];
        for (int j = 0; j < num_backends; j++) {
            q_table[i][j] = 0.0f;
        }
    }
}

QLearning::~QLearning() {
    for (int i = 0; i < max_states; i++) {
        delete[] q_table[i];
    }
    delete[] q_table;
}

int QLearning::getNextBackend(int current_state) {
    // Safety check
    if (current_state >= max_states) current_state = max_states - 1;

    // Epsilon-Greedy: Decide whether to explore or exploit
    float random_val = (float)rand() / RAND_MAX;
    
    if (random_val < epsilon) {
        // EXPLORE: Pick a random backend
        return rand() % num_backends;
    } else {
        // EXPLOIT: Pick the backend with the highest Q-value for this state
        int best_action = 0;
        float max_q = q_table[current_state][0];
        
        for (int a = 1; a < num_backends; a++) {
            if (q_table[current_state][a] > max_q) {
                max_q = q_table[current_state][a];
                best_action = a;
            }
        }
        return best_action;
    }
}

float QLearning::getMaxQ(int state) {
    if (state >= max_states) state = max_states - 1;
    float max_q = q_table[state][0];
    for (int a = 1; a < num_backends; a++) {
        if (q_table[state][a] > max_q) {
            max_q = q_table[state][a];
        }
    }
    return max_q;
}

void QLearning::provideFeedback(int backend_idx, int current_state, int next_state, float reward) {
    if (current_state >= max_states) current_state = max_states - 1;
    if (next_state >= max_states) next_state = max_states - 1;

    // The Bellman Equation!
    float old_q = q_table[current_state][backend_idx];
    float max_future_q = getMaxQ(next_state);
    
    float new_q = old_q + alpha * (reward + gamma * max_future_q - old_q);
    
    q_table[current_state][backend_idx] = new_q;
}

void QLearning::printQTable() {
    Serial.println("--- Q-Table ---");
    for (int s = 0; s < max_states; s++) {
        Serial.printf("State %d: ", s);
        for (int a = 0; a < num_backends; a++) {
            Serial.printf("%.2f \t", q_table[s][a]);
        }
        Serial.println();
    }
    Serial.println("---------------");
}