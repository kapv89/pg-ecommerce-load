# ecommerce-load workload

We need 2 types of workloads:

1. Baseline
2. Anomalous

In the baseline workload, the system should behave as if getting a regular day's ecommerce marketplace
traffic. Resources should be used moderately heavily, but things should be under saturation. Try hard
to ensure that no unoptimized db operations happen in the baseline workload.

In the anomalous workload, the system should behave as if getting a Black Friday sale level ecommerce market
traffic. Resources should be used heavily, and should reach near saturation (take care not to cause system breakage). There should be unoptimized db operations happening in the anomalous workload, this may be simulated by some business logic which is triggered in the normal workflows of the ecommerce marketplace
only when some sale event in db is turned on.

Both the loads should be triggerable via turbo commands.