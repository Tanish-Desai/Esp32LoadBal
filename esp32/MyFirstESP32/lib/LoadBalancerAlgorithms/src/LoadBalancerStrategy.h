#pragma once

class LoadBalancerStrategy {
public:
    virtual ~LoadBalancerStrategy() {}
    
    // Called when a new client connects to get the target backend index
    virtual int getNextBackend(int current_state = 0) = 0;

    // Called after a connection closes or completes to provide reward/feedback
    virtual void provideFeedback(int backend_idx, int current_state, float reward) {} 
};