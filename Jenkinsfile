
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 40, unit: 'MINUTES')
    }

    environment {
        AWS_DEFAULT_REGION = 'ap-south-1'
        AWS_REGION         = 'ap-south-1'
        AWS_ACCOUNT_ID     = '599243103173'
        EKS_CLUSTER        = 'blogapp-eks-cluster'
        APP_NAMESPACE      = 'blogapp'

        ECR_REGISTRY       = '599243103173.dkr.ecr.ap-south-1.amazonaws.com'
        BACKEND_REPO       = '599243103173.dkr.ecr.ap-south-1.amazonaws.com/blogapp-backend'
        FRONTEND_REPO      = '599243103173.dkr.ecr.ap-south-1.amazonaws.com/blogapp-frontend'

        NODE_IMAGE         = 'node:20-alpine'
        KUBECTL_PATH       = '/var/jenkins_home/tools/bin'
        KUBECONFIG         = "${WORKSPACE}/eks-kubeconfig"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    def gitSha = sh(
                        returnStdout: true,
                        script: 'git rev-parse --short=7 HEAD'
                    ).trim()

                    env.IMAGE_TAG = "${env.BUILD_NUMBER}-${gitSha}"
                } 
        }

        stage('Backend Tests and Lint') {
            steps {
                dir('backend') {
                    sh '''
                        set -eu
                        set +x

                        CID=$(docker create -w /app "$NODE_IMAGE" \
                          sh -ec "npm install --no-package-lock --no-audit --no-fund && npm test && npm run lint")

                        trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

                        docker cp . "$CID":/app
                        docker start -a "$CID"
                    '''
                }
            }
        }

        stage('Frontend Lint and Build') {
            steps {
                dir('frontend') {
                    sh '''
                        set -eu
                        set +x

                        CID=$(docker create -w /app "$NODE_IMAGE" \
                          sh -ec "npm install --no-package-lock --no-audit --no-fund && npm run lint && npm run build")

                        trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

                        docker cp . "$CID":/app
                        docker start -a "$CID"
                    '''
                }
            }
        }

        stage('Build Docker Images') {
            steps {
                sh '''
                    set -eu
                    set +x

                    echo "Building backend image..."
                    docker build --provenance=false \
                      -t "$BACKEND_REPO:$IMAGE_TAG" ./backend

                    echo "Building frontend image..."
                    docker build --provenance=false \
                      -t "$FRONTEND_REPO:$IMAGE_TAG" ./frontend

                    echo "Built images:"
                    docker image inspect "$BACKEND_REPO:$IMAGE_TAG" >/dev/null
                    docker image inspect "$FRONTEND_REPO:$IMAGE_TAG" >/dev/null
                '''
            }
        }

        stage('Push Images to ECR') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-blogapp-jenkins',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh '''
                        set -eu
                        set +x
                        export PATH="$KUBECTL_PATH:$PATH"

                        echo "Authenticating Docker with Amazon ECR..."
                        aws ecr get-login-password --region "$AWS_REGION" |
                          docker login --username AWS --password-stdin "$ECR_REGISTRY"

                        echo "Pushing backend image..."
                        docker push "$BACKEND_REPO:$IMAGE_TAG"

                        echo "Pushing frontend image..."
                        docker push "$FRONTEND_REPO:$IMAGE_TAG"

                        docker logout "$ECR_REGISTRY"
                        echo "Both images pushed successfully."
                    '''
                }
            }
        }

        stage('Configure EKS Access') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-blogapp-jenkins',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh '''
                        set -eu
                        set +x
                        export PATH="$KUBECTL_PATH:$PATH"

                        echo "Checking AWS identity..."
                        aws sts get-caller-identity

                        echo "Checking EKS cluster..."
                        aws eks describe-cluster \
                          --name "$EKS_CLUSTER" \
                          --region "$AWS_REGION" \
                          --query 'cluster.status' \
                          --output text

                        echo "Generating kubeconfig..."
                        aws eks update-kubeconfig \
                          --name "$EKS_CLUSTER" \
                          --region "$AWS_REGION" \
                          --kubeconfig "$KUBECONFIG"

                        echo "Checking Kubernetes access..."
                        kubectl get deployments -n "$APP_NAMESPACE"

                        echo "Checking deployment permission..."
                        kubectl auth can-i patch deployments \
                          -n "$APP_NAMESPACE"
                    '''
                }
            }
        }

        stage('Deploy to EKS') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-blogapp-jenkins',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh '''
                        set -eu
                        set +x
                        export PATH="$KUBECTL_PATH:$PATH"

                        echo "Updating backend image..."
                        kubectl set image deployment/backend \
                          backend="$BACKEND_REPO:$IMAGE_TAG" \
                          -n "$APP_NAMESPACE"

                        echo "Updating frontend image..."
                        kubectl set image deployment/frontend \
                          frontend="$FRONTEND_REPO:$IMAGE_TAG" \
                          -n "$APP_NAMESPACE"
                    '''
                }
            }
        }

        stage('Verify Deployment') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-blogapp-jenkins',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh '''
                        set -eu
                        set +x
                        export PATH="$KUBECTL_PATH:$PATH"

                        echo "Waiting for backend rollout..."
                        kubectl rollout status deployment/backend \
                          -n "$APP_NAMESPACE" --timeout=240s

                        echo "Waiting for frontend rollout..."
                        kubectl rollout status deployment/frontend \
                          -n "$APP_NAMESPACE" --timeout=240s

                        echo "Final deployment status:"
                        kubectl get deployments -n "$APP_NAMESPACE"

                        echo "Running pods:"
                        kubectl get pods -n "$APP_NAMESPACE"

                        echo "Services (read-only check):"
                        kubectl get services -n "$APP_NAMESPACE"

                        echo "Deployment verification completed."
                    '''
                }
            }
        }
    }

    post {
        success {
            echo "CI/CD succeeded. Deployed image tag: ${IMAGE_TAG}"
        }

        failure {
            echo 'Pipeline failed. Check the first failing stage in Console Output.'
        }

        always {
            echo 'Pipeline finished.'
        }
    }
}
